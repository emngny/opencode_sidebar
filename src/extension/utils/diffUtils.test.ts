import { describe, it, expect } from 'vitest';
import { normalizeDiff, NormalizedDiff } from './diffUtils';

describe('normalizeDiff', () => {
  it('should handle diff with path and content', () => {
    const input = {
      path: 'src/index.ts',
      content: '+1\n-2',
    };
    const result = normalizeDiff(input);
    expect(result.path).toBe('src/index.ts');
    expect(result.added).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('should handle diff with file field', () => {
    const input = {
      file: 'src/app.ts',
      content: '+5\n-3',
    };
    const result = normalizeDiff(input);
    expect(result.path).toBe('src/app.ts');
  });

  it('should use patch field as content', () => {
    const input = {
      path: 'test.js',
      patch: '+10\n-5',
    };
    const result = normalizeDiff(input);
    expect(result.content).toBe('+10\n-5');
  });

  it('should use provided added/deleted counts', () => {
    const input = {
      path: 'file.ts',
      added: 20,
      deleted: 10,
      content: '',
    };
    const result = normalizeDiff(input);
    expect(result.added).toBe(20);
    expect(result.deleted).toBe(10);
  });

  it('should count lines when added/deleted not provided', () => {
    const input = {
      path: 'test.ts',
      content: '+const a = 1;\n+const b = 2;\n-const c = 3;\n-const d = 4;\n+const e = 5;\n',
    };
    const result = normalizeDiff(input);
    expect(result.added).toBe(3);
    expect(result.deleted).toBe(2);
  });

  it('should ignore +++ and --- headers', () => {
    const input = {
      path: 'f.ts',
      content: '+++ b/src/f.ts\n- const a;\n+ const a = 1;\n',
    };
    const result = normalizeDiff(input);
    expect(result.added).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('should handle empty content', () => {
    const input = { path: 'empty.ts', content: '' };
    const result = normalizeDiff(input);
    expect(result.path).toBe('empty.ts');
    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it('should handle missing fields', () => {
    const input = { notAPath: 'value' };
    const result = normalizeDiff(input);
    expect(result.path).toBe('');
  });
});