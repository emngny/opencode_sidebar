import { describe, expect, it, vi } from 'vitest';
import { GitService } from './GitService';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'diff') }));

describe('GitService', () => {
  it('removes shell operators and unsupported flags', () => {
    const service = new GitService('/workspace', vi.fn());
    expect(service.sanitizeReviewArgs('--stat -U3 --bad')).toEqual(['--stat', '-U3']);
  });

  it('returns review prompt for staged diff', () => {
    const service = new GitService('/workspace', vi.fn());
    expect(service.createReviewPrompt('')).toContain('Review the following uncommitted changes');
  });
});
