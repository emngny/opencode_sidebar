import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveWorkspacePath } from './workspacePath';

describe('resolveWorkspacePath', () => {
  it('resolves a relative path inside the workspace', () => {
    const result = resolveWorkspacePath('/workspace', 'src/file.ts');
    expect(result).toEqual({
      ok: true,
      resolvedPath: path.resolve('/workspace/src/file.ts'),
      relativePath: path.join('src', 'file.ts'),
    });
  });

  it('rejects traversal paths, including mixed separators', () => {
    for (const input of ['../secret.txt', 'a/../../secret.txt', 'a\\..\\..\\secret.txt', '..\\..\\secret.txt']) {
      expect(resolveWorkspacePath('/workspace', input).ok).toBe(false);
    }
  });

  it('rejects absolute paths', () => {
    for (const input of [
      '/etc/passwd',
      'C:\\Windows\\secret.txt',
      'C:/Windows/secret.txt',
      '\\\\server\\share\\secret.txt',
    ]) {
      expect(resolveWorkspacePath('/workspace', input).ok).toBe(false);
    }
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink file that escapes the workspace', () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-workspace-path-'));
    try {
      const workspace = path.join(sandbox, 'workspace');
      const outside = path.join(sandbox, 'outside.txt');
      mkdirSync(workspace);
      writeFileSync(outside, 'secret');
      symlinkSync(outside, path.join(workspace, 'link.txt'));

      expect(resolveWorkspacePath(workspace, 'link.txt')).toMatchObject({ ok: false });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('rejects a nested symlink directory that escapes the workspace', () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-workspace-path-'));
    try {
      const workspace = path.join(sandbox, 'workspace');
      const outside = path.join(sandbox, 'outside');
      mkdirSync(workspace);
      mkdirSync(outside);
      writeFileSync(path.join(outside, 'secret.txt'), 'secret');
      symlinkSync(outside, path.join(workspace, 'linked-dir'), 'junction');

      expect(resolveWorkspacePath(workspace, 'linked-dir/secret.txt')).toMatchObject({ ok: false });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
