export const READ_DENY_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/.env.local',
  '**/.env.production',
  '**/.env.development',
  '**/node_modules/**',
  '**/.git/**',
  '**/*secret*',
  '**/*password*',
  '**/*token*',
  '**/*credential*',
  '**/*.key',
  '**/*.pem',
  '**/*.cert',
  '**/*.p12',
  '**/*.pfx',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
];

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function isReadDenied(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of READ_DENY_PATTERNS) {
    const regex = patternToRegex(pattern);
    if (regex.test(normalized)) {
      return pattern;
    }
  }
  return null;
}
