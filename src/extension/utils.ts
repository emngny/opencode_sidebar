import { randomBytes } from 'node:crypto';

export function getNonce(): string {
  return randomBytes(32).toString('hex');
}
