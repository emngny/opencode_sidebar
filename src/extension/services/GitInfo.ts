import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { GitInfo } from '../../shared/types';

function getGitExecutable(): string {
  const programFiles = process.env.ProgramFiles || String.raw`C:\Program Files`;
  const programFilesX86 = process.env['ProgramFiles(x86)'] || String.raw`C:\Program Files (x86)`;
  const candidates =
    process.platform === 'win32'
      ? [
          String.raw`${programFiles}\Git\cmd\git.exe`,
          String.raw`${programFilesX86}\Git\cmd\git.exe`,
          String.raw`${process.env.LOCALAPPDATA || ''}\Programs\Git\cmd\git.exe`,
        ]
      : ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
  return candidates.find((candidate) => existsSync(candidate)) || candidates.at(-1) || '/usr/bin/git';
}

export function getGitInfo(): GitInfo {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const projectPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : 'Unknown';

  let branch = 'Unknown';
  let lastCommitTime = 'Unknown';

  try {
    branch = execFileSync(getGitExecutable(), ['branch', '--show-current'], {
      cwd: projectPath,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }).trim();
  } catch {
    // not a git repo or git not available
  }

  try {
    const output = execFileSync(getGitExecutable(), ['log', '-1', '--format=%cd', '--date=relative'], {
      cwd: projectPath,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    }).trim();
    lastCommitTime = output;
  } catch {
    // no commits or git not available
  }

  return { branch, lastCommitTime, projectPath };
}
