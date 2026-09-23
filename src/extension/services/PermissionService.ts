import { isReadDenied } from './readPatterns';

/**
 * Handles file read permission checks against deny patterns (readPatterns.ts).
 * Manages pending permission requests and "always allow" caching.
 */
export class PermissionService {
  private readonly _readAllowCache = new Set<string>();
  private readonly _pendingResolvers = new Map<
    string,
    Set<(response: { allowed: boolean; remember?: boolean }) => void>
  >();

  isReadAllowed(filePath: string): { allowed: boolean; deniedPattern?: string } {
    const deniedPattern = isReadDenied(filePath);
    if (!deniedPattern) return { allowed: true };
    if (this._readAllowCache.has(filePath)) return { allowed: true };
    return { allowed: false, deniedPattern };
  }

  waitForReadPermission(filePath: string): Promise<boolean> {
    const deniedPattern = isReadDenied(filePath);
    if (deniedPattern && this._readAllowCache.has(filePath)) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const resolver = (response: { allowed: boolean; remember?: boolean }) => resolve(response.allowed);
      const resolvers = this._pendingResolvers.get(filePath) ?? new Set();
      resolvers.add(resolver);
      this._pendingResolvers.set(filePath, resolvers);
    });
  }

  grantReadPermission(filePath: string, response: 'allow' | 'deny', remember?: boolean): void {
    const resolvers = this._pendingResolvers.get(filePath);
    if (!resolvers) return;
    if (response === 'allow' && remember && isReadDenied(filePath)) {
      this._readAllowCache.add(filePath);
    }
    for (const resolver of resolvers) resolver({ allowed: response === 'allow', remember });
    this._pendingResolvers.delete(filePath);
  }
}
