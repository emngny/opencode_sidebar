import { isReadDenied } from './readPatterns';

/**
 * Handles file read permission checks against deny patterns (readPatterns.ts).
 * Manages pending permission requests and "always allow" caching.
 */
export class PermissionService {
  private readonly _readAllowCache = new Map<string, string>();
  private readonly _pendingResolvers = new Map<string, (response: { allowed: boolean; remember?: boolean }) => void>();

  private cacheKey(pattern: string, filePath: string): string {
    return `${pattern}:${filePath}`;
  }

  isReadAllowed(filePath: string): { allowed: boolean; deniedPattern?: string } {
    const deniedPattern = isReadDenied(filePath);
    if (!deniedPattern) return { allowed: true };
    if (this._readAllowCache.has(this.cacheKey(deniedPattern, filePath))) return { allowed: true };
    return { allowed: false, deniedPattern };
  }

  waitForReadPermission(filePath: string): Promise<boolean> {
    const deniedPattern = isReadDenied(filePath);
    if (deniedPattern && this._readAllowCache.has(this.cacheKey(deniedPattern, filePath))) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this._pendingResolvers.set(filePath, (resp) => resolve(resp.allowed));
    });
  }

  grantReadPermission(filePath: string, response: 'allow' | 'deny', remember?: boolean): void {
    const resolver = this._pendingResolvers.get(filePath);
    if (!resolver) return;
    if (response === 'allow' && remember) {
      const pattern = isReadDenied(filePath);
      if (pattern) this._readAllowCache.set(this.cacheKey(pattern, filePath), filePath);
    }
    resolver({ allowed: response === 'allow', remember });
    this._pendingResolvers.delete(filePath);
  }
}
