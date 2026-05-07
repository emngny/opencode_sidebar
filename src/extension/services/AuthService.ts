import * as vscode from 'vscode';
import { OpencodeCli } from './OpencodeCli';
import { ApiClient } from './ApiClient';

/**
 * Manages API key persistence via VS Code SecretStorage.
 * Restores keys on startup and stores new keys after successful auth.
 */
export class AuthService {
  private _apiClient: ApiClient | null = null;

  constructor(
    private readonly _opencode: OpencodeCli,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  private ensureApiClient(): ApiClient {
    if (!this._opencode.url || !this._opencode.authHeader) {
      throw new Error('Opencode server not running');
    }
    if (!this._apiClient) {
      this._apiClient = new ApiClient({
        baseUrl: this._opencode.url,
        authHeader: this._opencode.authHeader,
      });
    } else {
      this._apiClient.updateAuth(this._opencode.url, this._opencode.authHeader);
    }
    return this._apiClient;
  }

  async restoreApiKeys(): Promise<void> {
    try {
      const authData = await this.ensureApiClient().getProviderAuth();
      for (const [providerId] of Object.entries(authData)) {
        const stored = await this._context.secrets.get(`opencode-key-${providerId}`);
        if (stored) {
          await this.ensureApiClient().setAuth(providerId, stored);
        }
      }
    } catch {
      // No keys to restore
    }
  }

  async setApiKey(providerId: string, key: string): Promise<boolean> {
    const success = await this.ensureApiClient().setAuth(providerId, key);
    if (success) {
      await this._context.secrets.store(`opencode-key-${providerId}`, key);
    }
    return success;
  }

  async removeApiKey(providerId: string): Promise<void> {
    await this.ensureApiClient().removeAuth(providerId);
    await this._context.secrets.delete(`opencode-key-${providerId}`);
  }
}
