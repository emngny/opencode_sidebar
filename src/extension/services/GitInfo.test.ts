// SonarQube: Vitest test source; S2187 does not detect this test harness.
// NOSONAR - test file intentionally contains no production exports.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as vscode from 'vscode';
import { getGitInfo } from './GitInfo';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [] },
}));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [];
});

describe('getGitInfo', () => {
  it('returns Unknown when no workspace folder exists', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a repository');
    });

    expect(getGitInfo()).toEqual({
      projectPath: 'Unknown',
      branch: 'Unknown',
      lastCommitTime: 'Unknown',
    });
  });

  it('reads branch and relative commit time from first workspace folder', () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/workspace/project' } }];
    vi.mocked(execFileSync).mockReturnValueOnce('main\n').mockReturnValueOnce('2 hours ago\n');

    expect(getGitInfo()).toEqual({
      projectPath: '/workspace/project',
      branch: 'main',
      lastCommitTime: '2 hours ago',
    });
    const gitArgs = vi.mocked(execFileSync).mock.calls[0];
    const logArgs = vi.mocked(execFileSync).mock.calls[1];
    expect(gitArgs[0]).toMatch(/git(?:\.exe)?$/);
    expect(gitArgs[1]).toEqual(['branch', '--show-current']);
    expect(gitArgs[2]).toEqual({ cwd: '/workspace/project', encoding: 'utf8', shell: false, windowsHide: true });
    expect(logArgs[0]).toMatch(/git(?:\.exe)?$/);
    expect(logArgs[1]).toEqual(['log', '-1', '--format=%cd', '--date=relative']);
    expect(logArgs[2]).toEqual({ cwd: '/workspace/project', encoding: 'utf8', shell: false, windowsHide: true });
  });

  it('keeps successful values when one git command fails', () => {
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [{ uri: { fsPath: '/workspace/project' } }];
    vi.mocked(execFileSync)
      .mockReturnValueOnce('feature\n')
      .mockImplementationOnce(() => {
        throw new Error('no commits');
      });

    expect(getGitInfo()).toEqual({
      projectPath: '/workspace/project',
      branch: 'feature',
      lastCommitTime: 'Unknown',
    });
  });
});
