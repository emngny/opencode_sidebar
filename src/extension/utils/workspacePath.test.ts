import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
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
});
