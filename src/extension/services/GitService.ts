import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function getGitExecutable(): string {
  const programFiles = process.env.ProgramFiles || String.raw`C:\Program Files`;
  const programFilesX86 = process.env['ProgramFiles(x86)'] || String.raw`C:\Program Files (x86)`;
  const candidates = process.platform === 'win32'
    ? [
        String.raw`${programFiles}\Git\cmd\git.exe`,
        String.raw`${programFilesX86}\Git\cmd\git.exe`,
        String.raw`${process.env.LOCALAPPDATA || ''}\Programs\Git\cmd\git.exe`,
      ]
    : ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'];
  return candidates.find((candidate) => existsSync(candidate)) || candidates.at(-1) || '/usr/bin/git';
}

export class GitService {
  private static readonly ALLOWED_FLAGS = new Set([
    '--no-index', '-U', '--unified', '--stat', '--shortstat', '--numstat',
    '--name-only', '--name-status', '--check', '--color', '--color-words',
  ]);

  constructor(
    private readonly _root: string,
    private readonly _processPrompt: (prompt: string, mode: string) => Promise<void>,
  ) {}

  sanitizeReviewArgs(args: string): string[] {
    if (!args) return [];
    const parsed: string[] = [];
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(args)) !== null) parsed.push(match[1] || match[2] || match[0]);
    return parsed.filter((arg) => {
      if (arg.startsWith('--') && !GitService.ALLOWED_FLAGS.has(arg)) return false;
      if (/^-[^-]/.test(arg) && !/^-U\d+$/.test(arg)) return false;
      return !arg.includes(';') && !arg.includes('|') && !arg.includes('&&') && !arg.includes('||');
    });
  }

  createReviewPrompt(diff: string): string {
    return `Review the following uncommitted changes:\n\n${diff.slice(0, 10000)}${diff.length > 10000 ? '\n...(truncated)' : ''}\n\nProvide a concise code review focusing on potential bugs, security issues, and improvements.`;
  }

  async review(args: string): Promise<void> {
    const diff = execFileSync(getGitExecutable(), ['diff', '--cached', ...this.sanitizeReviewArgs(args)], {
      cwd: this._root,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
    });
    await this._processPrompt(this.createReviewPrompt(diff), 'review');
  }
}
