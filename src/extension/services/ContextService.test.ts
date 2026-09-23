import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ContextService } from './ContextService';
import type { PermissionService } from './PermissionService';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], fs: { readFile: vi.fn() } },
  Uri: { joinPath: vi.fn((_root, file) => ({ fsPath: `/workspace/${file}` })) },
}));

describe('ContextService', () => {
  it('returns prompt unchanged without context', async () => {
    const permissions = { isReadAllowed: vi.fn(), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    const result = await new ContextService(permissions, vi.fn()).process('hello', undefined);
    expect(result).toEqual({ userContent: 'hello', extraParts: [] });
  });

  it('skips files larger than 1 MB', async () => {
    const permissions = { isReadAllowed: vi.fn().mockReturnValue({ allowed: true }), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    const readFile = vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array(1024 * 1024 + 1));

    const result = await new ContextService(permissions, vi.fn()).process('hello', [{ type: 'file', name: 'large.txt', path: 'large.txt' }]);

    expect(readFile).toHaveBeenCalledOnce();
    expect(result.userContent).toContain('exceeds 1 MB context limit');
    expect(result.extraParts).toHaveLength(0);
  });

  it('skips binary files', async () => {
    const permissions = { isReadAllowed: vi.fn().mockReturnValue({ allowed: true }), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Uint8Array.from([0x41, 0x00, 0x42]));

    const result = await new ContextService(permissions, vi.fn()).process('hello', [{ type: 'file', name: 'binary.bin', path: 'binary.bin' }]);

    expect(result.userContent).toContain('binary file');
    expect(result.extraParts).toHaveLength(0);
  });

  it('caps extra context parts at 100', async () => {
    const permissions = { isReadAllowed: vi.fn().mockReturnValue({ allowed: true }), waitForReadPermission: vi.fn() } as unknown as PermissionService;
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('content'));
    const context = Array.from({ length: 101 }, (_, index) => ({ type: 'file' as const, name: `file-${index}.txt`, path: `file-${index}.txt` }));

    const result = await new ContextService(permissions, vi.fn()).process('hello', context);

    expect(result.extraParts).toHaveLength(100);
    expect(result.userContent).toContain('extra part limit reached');
  });
});
