import * as vscode from 'vscode';
import { OpencodeCli } from './OpencodeCli';

/**
 * Manages API key persistence via VS Code SecretStorage.
 * Restores keys on startup and stores new keys after successful auth.
 */
export class AuthService {
  constructor(
    private readonly _opencode: OpencodeCli,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  async restoreApiKeys(): Promise<void> {
    try {
      const authData = await this._opencode.getProviderAuth();
      for (const [providerId] of Object.entries(authData)) {
        const stored = await this._context.secrets.get(`opencode-key-${providerId}`);
        if (stored) {
          await this._opencode.setAuth(providerId, stored);
        }
      }
    } catch {
      // No keys to restore
    }
  }

  async setApiKey(providerId: string, key: string): Promise<boolean> {
    const success = await this._opencode.setAuth(providerId, key);
    if (success) {
      await this._context.secrets.store(`opencode-key-${providerId}`, key);
    }
    return success;
  }

  async removeApiKey(providerId: string): Promise<void> {
    await this._opencode.removeAuth(providerId);
    await this._context.secrets.delete(`opencode-key-${providerId}`);
  }
}
