import { describe, it, expect } from 'vitest';
import { isReadDenied, READ_DENY_PATTERNS } from './readPatterns';

describe('READ_DENY_PATTERNS', () => {
  it('should be an array of patterns', () => {
    expect(READ_DENY_PATTERNS).toBeInstanceOf(Array);
    expect(READ_DENY_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('isReadDenied', () => {
  it('should return null for allowed files', () => {
    expect(isReadDenied('src/index.ts')).toBeNull();
    expect(isReadDenied('src/app/App.tsx')).toBeNull();
    expect(isReadDenied('README.md')).toBeNull();
    expect(isReadDenied('docs/guide.md')).toBeNull();
  });

  it('should deny .env files in subdirectories', () => {
    expect(isReadDenied('config/.env')).not.toBeNull();
    expect(isReadDenied('app/config/.env.prod')).not.toBeNull();
    expect(isReadDenied('src/config/.env.local')).not.toBeNull();
  });

  it('should deny node_modules in subdirectories', () => {
    expect(isReadDenied('src/node_modules/lodash/index.js')).not.toBeNull();
    expect(isReadDenied('very/deep/node_modules/pkg/index.js')).not.toBeNull();
  });

  it('should deny .git directory in subdirectories', () => {
    expect(isReadDenied('src/.git/HEAD')).not.toBeNull();
    expect(isReadDenied('project/.git/config')).not.toBeNull();
  });

  it('should deny files with secret keywords in path', () => {
    expect(isReadDenied('config/secrets.json')).not.toBeNull();
    expect(isReadDenied('src/config/my_password_file.txt')).not.toBeNull();
    expect(isReadDenied('auth/api_token.json')).not.toBeNull();
    expect(isReadDenied('settings/credentials.yaml')).not.toBeNull();
  });

  it('should deny files with key/secret in filename', () => {
    expect(isReadDenied('path/to/my_key.pem')).not.toBeNull();
    expect(isReadDenied('path/to/server.key')).not.toBeNull();
  });

  it('should deny build artifacts in subdirectories', () => {
    expect(isReadDenied('src/dist/index.js')).not.toBeNull();
    expect(isReadDenied('project/build/app.js')).not.toBeNull();
    expect(isReadDenied('generated/out/extension.js')).not.toBeNull();
  });

  it('should deny lock files when in a subdirectory', () => {
    expect(isReadDenied('some/path/package-lock.json')).not.toBeNull();
    expect(isReadDenied('project/yarn.lock')).not.toBeNull();
    expect(isReadDenied('libs/pnpm-lock.yaml')).not.toBeNull();
  });

  it('should handle Windows backslashes in subdirectories', () => {
    expect(isReadDenied('a/b\\config\\.env')).not.toBeNull();
    expect(isReadDenied('a/b\\node_modules\\lodash\\index.js')).not.toBeNull();
  });

  it('should return matching pattern when denied', () => {
    const result = isReadDenied('config/.env');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('should handle deep paths', () => {
    expect(isReadDenied('very/deep/nested/path/node_modules/pkg/index.js')).not.toBeNull();
    expect(isReadDenied('a/b/c/d/e/f/.env.local')).not.toBeNull();
  });

  it('should not false-positive on allowed files', () => {
    expect(isReadDenied('src/env.ts')).toBeNull();
  });
});