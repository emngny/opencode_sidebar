import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { SkillService } from './SkillService';

vi.mock('vscode', () => ({ workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] } }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:path', () => ({ join: vi.fn((...parts: string[]) => parts.join('/')) }));

describe('SkillService', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

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

  it('loads a skill by exact directory entry', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.readdirSync).mockReturnValue([{ name: 'alpha', isDirectory: () => true }] as never);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Alpha');

    expect(new SkillService().load('alpha')).toBe('# Alpha');
    expect(fs.readFileSync).toHaveBeenCalledWith('/workspace/.agents/skills/alpha/SKILL.md', 'utf-8');
  });

  it.each(['../secret', '..\\secret', '/absolute', 'nested/name', 'name/SKILL.md'])(
    'rejects unsafe skill name: %s',
    async (name) => {
      const fs = await import('node:fs');
      expect(new SkillService().load(name)).toBeNull();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    },
  );
});
