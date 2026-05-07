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
  '**/.ssh/**',
  '**/.aws/**',
  '**/.kube/**',
  '**/.npmrc',
  '**/.npm-token',
  '**/.netrc',
  '**/id_rsa',
  '**/id_dsa',
  '**/id_ecdsa',
  '**/id_ed25519',
  '**/known_hosts',
  '**/authorized_keys',
  '**/.aws/credentials',
  '**/.aws/config',
  '**/.azure/**',
  '**/.google_credentials/**',
  '**/service-account.json',
  '**/*.googleapis.*',
];

const regexCache = new Map<string, RegExp>();

function patternToRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern);
  if (regex) return regex;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  regex = new RegExp(`^${escaped}$`, 'i');
  regexCache.set(pattern, regex);
  return regex;
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
