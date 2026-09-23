import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { SkillService } from './SkillService';

vi.mock('vscode', () => ({ workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] } }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), readdirSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('node:path', () => ({ join: vi.fn((...parts: string[]) => parts.join('/')) }));

describe('SkillService', () => {
  it('lists valid skill markdown files', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'alpha', isDirectory: () => true },
      { name: 'ignored', isDirectory: () => false },
    ] as never);
    vi.mocked(fs.readFileSync).mockReturnValue('# Alpha\nDescription');
    expect(new SkillService().list()).toEqual([{ name: 'alpha', description: 'Alpha' }]);
  });
});
