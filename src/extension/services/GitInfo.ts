import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import { GitInfo } from '../types';

export function getGitInfo(): GitInfo {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const projectPath = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : 'Unknown';

  let branch = 'Unknown';
  let lastCommitTime = 'Unknown';

  try {
    branch = execFileSync('git', ['branch', '--show-current'], { cwd: projectPath, encoding: 'utf8' }).trim();
  } catch {
    // not a git repo or git not available
  }

  try {
    const output = execFileSync('git', ['log', '-1', '--format=%cd', '--date=relative'], { cwd: projectPath, encoding: 'utf8' }).trim();
    lastCommitTime = output;
  } catch {
    // no commits or git not available
  }

  return { branch, lastCommitTime, projectPath };
}
