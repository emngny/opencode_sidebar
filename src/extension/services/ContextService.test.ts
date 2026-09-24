import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ContextService } from './ContextService';
import type { PermissionService } from './PermissionService';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], fs: { readFile: vi.fn() } },
  Uri: { file: vi.fn((fsPath) => ({ fsPath })) },
}));

describe('ContextService', () => {
  beforeEach(() => {
    vi.mocked(vscode.workspace.fs.readFile).mockReset();
  });

  it('returns prompt unchanged without context', async () => {
    const permissions = { isReadAllowed: vi.fn(), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    const result = await new ContextService(permissions, vi.fn()).process('hello', undefined);
    expect(result).toEqual({ userContent: 'hello', extraParts: [] });
  });

  it('converts a valid image attachment to an image part', async () => {
    const permissions = { isReadAllowed: vi.fn(), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    const result = await new ContextService(permissions, vi.fn()).process('describe this', [
      { type: 'image', name: 'shot.png', data: 'aGVsbG8=', mimeType: 'image/png' },
    ]);

    expect(result).toEqual({
      userContent: 'describe this',
      extraParts: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink file escaping the workspace before reading it',
    async () => {
      const sandbox = mkdtempSync(path.join(tmpdir(), 'opencode-context-'));
      const workspacePath = path.join(sandbox, 'workspace');
      const outsidePath = path.join(sandbox, 'outside.txt');
      const originalRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      try {
        mkdirSync(workspacePath);
        writeFileSync(outsidePath, 'secret');
        symlinkSync(outsidePath, path.join(workspacePath, 'safe.txt'));
        (vscode.workspace.workspaceFolders as unknown as Array<{ uri: { fsPath: string } }>)[0].uri.fsPath =
          workspacePath;

        const permissions = { isReadAllowed: vi.fn(), waitForReadPermission: vi.fn() } as unknown as PermissionService;
        const post = vi.fn();
        const result = await new ContextService(permissions, post).process('read this', [
          { type: 'file', name: 'safe.txt', path: 'safe.txt' },
        ]);

        expect(result.userContent).toContain('[Skipped: safe.txt — outside workspace]');
        expect(result.extraParts).toEqual([]);
        expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'toolEvent' }));
      } finally {
        if (originalRoot) {
          (vscode.workspace.workspaceFolders as unknown as Array<{ uri: { fsPath: string } }>)[0].uri.fsPath =
            originalRoot;
        }
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );

  it('rejects non-image MIME types', async () => {
    const permissions = { isReadAllowed: vi.fn(), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    const result = await new ContextService(permissions, vi.fn()).process('', [
      { type: 'image', name: 'not-image.txt', data: 'aGVsbG8=', mimeType: 'text/plain' },
    ]);

    expect(result.extraParts).toEqual([]);
  });

  it('skips files larger than 1 MB', async () => {
    const permissions = {
      isReadAllowed: vi.fn().mockReturnValue({ allowed: true }),
      waitForReadPermission: vi.fn(),
    } as unknown as PermissionService;
    const readFile = vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array(1024 * 1024 + 1));

    const result = await new ContextService(permissions, vi.fn()).process('hello', [
      { type: 'file', name: 'large.txt', path: 'large.txt' },
    ]);

    expect(readFile).toHaveBeenCalledOnce();
    expect(result.userContent).toContain('exceeds 1 MB context limit');
    expect(result.extraParts).toHaveLength(0);
  });

  it('skips binary files', async () => {
    const permissions = {
      isReadAllowed: vi.fn().mockReturnValue({ allowed: true }),
      waitForReadPermission: vi.fn(),
    } as unknown as PermissionService;
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Uint8Array.from([0x41, 0x00, 0x42]));

    const result = await new ContextService(permissions, vi.fn()).process('hello', [
      { type: 'file', name: 'binary.bin', path: 'binary.bin' },
    ]);

    expect(result.userContent).toContain('binary file');
    expect(result.extraParts).toHaveLength(0);
  });

  it.each(['../secret.txt', 'a\\..\\..\\secret.txt', '/etc/passwd', 'C:\\Windows\\secret.txt'])(
    'skips path outside workspace: %s',
    async (filePath) => {
      const permissions = {
        isReadAllowed: vi.fn().mockReturnValue({ allowed: true }),
        waitForReadPermission: vi.fn(),
      } as unknown as PermissionService;
      const readFile = vi.mocked(vscode.workspace.fs.readFile);

      const result = await new ContextService(permissions, vi.fn()).process('hello', [
        { type: 'file', name: 'secret.txt', path: filePath },
      ]);

      expect(result.userContent).toContain('outside workspace');
      expect(readFile).not.toHaveBeenCalled();
      expect(permissions.isReadAllowed).not.toHaveBeenCalled();
    },
  );

  it('caps extra context parts at 100', async () => {
    const permissions = {
      isReadAllowed: vi.fn().mockReturnValue({ allowed: true }),
      waitForReadPermission: vi.fn(),
    } as unknown as PermissionService;
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('content'));
    const context = Array.from({ length: 101 }, (_, index) => ({
      type: 'file' as const,
      name: `file-${index}.txt`,
      path: `file-${index}.txt`,
    }));

    const result = await new ContextService(permissions, vi.fn()).process('hello', context);

    expect(result.extraParts).toHaveLength(100);
    expect(result.userContent).toContain('extra part limit reached');
  });
});
