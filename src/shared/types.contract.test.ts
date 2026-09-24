import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const typesPath = path.join(here, 'types.ts');
const projectRoot = path.resolve(here, '..', '..');

/**
 * Print every exported declaration of the shared contract with comments and
 * formatting stripped, so the snapshot reflects structure only. Any field
 * added/removed/renamed — or any allow-list change — fails this test and must
 * be acknowledged by updating the snapshot in the same change.
 */
function exportedContractShapes(): string {
  const source = readFileSync(typesPath, 'utf8');
  const sourceFile = ts.createSourceFile(typesPath, source, ts.ScriptTarget.ES2022, true);
  const printer = ts.createPrinter({ removeComments: true });
  const shapes: string[] = [];

  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!isExported) continue;
    shapes.push(printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile).trim());
  }

  if (shapes.length === 0) {
    throw new Error('shared/types.ts exported no declarations — contract parse failed');
  }
  return shapes.join('\n\n');
}

describe('shared/types.ts contract lock', () => {
  it('locks the shape of every exported declaration', () => {
    expect(exportedContractShapes()).toMatchSnapshot();
  });

  it('is compiled by both the extension and the webview targets', () => {
    for (const configName of ['tsconfig.extension.json', 'tsconfig.webview.json']) {
      const config = JSON.parse(readFileSync(path.join(projectRoot, configName), 'utf8')) as {
        include?: string[];
      };
      expect(config.include, `${configName} must include src/shared/**/*`).toContain('src/shared/**/*');
    }
  });

  it('keeps both message allow-lists non-empty and distinct from each other', async () => {
    const { WEBVIEW_TO_EXTENSION_TYPES, EXTENSION_TO_WEBVIEW_TYPES } = await import('./types');
    expect(WEBVIEW_TO_EXTENSION_TYPES.length).toBeGreaterThan(0);
    expect(EXTENSION_TO_WEBVIEW_TYPES.length).toBeGreaterThan(0);
    expect(new Set(WEBVIEW_TO_EXTENSION_TYPES).size).toBe(WEBVIEW_TO_EXTENSION_TYPES.length);
    expect(new Set(EXTENSION_TO_WEBVIEW_TYPES).size).toBe(EXTENSION_TO_WEBVIEW_TYPES.length);
  });
});
