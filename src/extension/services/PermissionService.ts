import { isReadDenied } from './readPatterns';

export class PermissionService {
  private readonly _readAllowCache = new Map<string, string>();
  private readonly _pendingResolvers = new Map<string, (response: { allowed: boolean; remember?: boolean }) => void>();

  isReadAllowed(filePath: string): { allowed: boolean; deniedPattern?: string } {
    const deniedPattern = isReadDenied(filePath);
    if (!deniedPattern) return { allowed: true };
    if (this._readAllowCache.has(deniedPattern)) return { allowed: true };
    return { allowed: false, deniedPattern };
  }

  waitForReadPermission(filePath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._pendingResolvers.set(filePath, (resp) => resolve(resp.allowed));
    });
  }

  grantReadPermission(filePath: string, response: 'allow' | 'deny', remember?: boolean): void {
    const resolver = this._pendingResolvers.get(filePath);
    if (!resolver) return;
    if (response === 'allow' && remember) {
      const pattern = isReadDenied(filePath);
      if (pattern) this._readAllowCache.set(pattern, filePath);
    }
    resolver({ allowed: response === 'allow', remember });
    this._pendingResolvers.delete(filePath);
  }
}
