import { execFileSync } from 'node:child_process';

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
    const diff = execFileSync('git', ['diff', '--cached', ...this.sanitizeReviewArgs(args)], {
      cwd: this._root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024,
    });
    await this._processPrompt(this.createReviewPrompt(diff), 'review');
  }
}
