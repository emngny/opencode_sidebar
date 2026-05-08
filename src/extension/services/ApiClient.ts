import { ProviderListResult } from '../types';
import { NormalizedDiff, normalizeDiff } from '../utils/diffUtils';

export interface ApiClientOptions {
  baseUrl: string;
  authHeader: Record<string, string>;
}

/**
 * HTTP client for the opencode server REST API.
 * Wraps fetch with auth headers and error handling.
 */
export class ApiClient {
  private baseUrl: string;
  private authHeader: Record<string, string>;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.authHeader = options.authHeader;
  }

  updateAuth(baseUrl: string, authHeader: Record<string, string>): void {
    this.baseUrl = baseUrl;
    this.authHeader = authHeader;
  }

  private async fetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeader,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      const isJson = text.startsWith('{') || text.startsWith('[');
      const safeMsg = isJson && text.includes('"error"') ? 'JSON error response' : text.slice(0, 100);
      console.error(`[opencode:api] ${options.method || 'GET'} ${path} -> ${response.status}: ${safeMsg}`);
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    return response.text() as unknown as T;
  }

  async createSession(title?: string): Promise<{ id: string; title?: string }> {
    const data = await this.fetch<{ id: string; title?: string }>('/session', {
      method: 'POST',
      body: JSON.stringify({
        title: title || `VS Code - ${new Date().toLocaleString()}`,
      }),
    });
    return { id: data.id, title: data.title };
  }

  async listSessions(): Promise<{ id: string; title?: string }[]> {
    const data = await this.fetch<{ id: string; title?: string }[]>('/session');
    return Array.isArray(data) ? data : [];
  }

  async getSessionDiff(sessionId: string): Promise<NormalizedDiff[]> {
    const result = await this.fetch<{ files?: NormalizedDiff[] } | NormalizedDiff[]>(`/session/${sessionId}/diff`);
    let arr: any[] = [];
    if (Array.isArray(result)) {
      arr = result;
    } else if (result && 'files' in result) {
      arr = result.files || [];
    }
    const normalized = arr.map(normalizeDiff);
    return normalized;
  }

  async getSessionMessages(sessionId: string): Promise<any[]> {
    try {
      return await this.fetch(`/session/${sessionId}/message`);
    } catch {
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.fetch(`/session/${sessionId}`, { method: 'DELETE' });
      return true;
    } catch {
      return false;
    }
  }

  async getAgents(): Promise<string[]> {
    try {
      const result = await this.fetch<any>('/agent');
      if (Array.isArray(result)) {
        return result.map((a: any) => {
          if (typeof a === 'string') return a;
          return a.id || a.name || a.slug || a.key || '';
        }).filter(Boolean);
      }
      if (result && Array.isArray(result.agents)) {
        return result.agents.map((a: any) => {
          if (typeof a === 'string') return a;
          return a.id || a.name || a.slug || a.key || '';
        }).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }

  async getCurrentProject(): Promise<any> {
    try {
      return await this.fetch('/project/current');
    } catch {
      return null;
    }
  }

  async getPath(): Promise<any> {
    try {
      return await this.fetch('/path');
    } catch {
      return null;
    }
  }

  async getVcsInfo(): Promise<any> {
    try {
      return await this.fetch('/vcs');
    } catch {
      return null;
    }
  }

  async listProviders(): Promise<ProviderListResult> {
    return this.fetch('/provider');
  }

  async getProviderAuth(): Promise<Record<string, Array<{ type: string; label: string; prompts?: any[] }>>> {
    return this.fetch('/provider/auth');
  }

  async setAuth(providerId: string, key: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/${providerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ type: 'api', key }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async removeAuth(providerId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/${providerId}`, {
        method: 'DELETE',
        headers: { ...this.authHeader },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async summarizeSession(sessionId: string, providerID: string, modelID: string): Promise<boolean> {
    try {
      const result = await this.fetch(`/session/${sessionId}/summarize`, {
        method: 'POST',
        body: JSON.stringify({ providerID, modelID, auto: false }),
      });
      return result === true || result === 'true';
    } catch {
      return false;
    }
  }

  async revertSession(sessionId: string, messageId: string): Promise<any> {
    try {
      return await this.fetch(`/session/${sessionId}/revert`, {
        method: 'POST',
        body: JSON.stringify({ messageID: messageId }),
      });
    } catch {
      return null;
    }
  }

  async unrevertSession(sessionId: string): Promise<any> {
    try {
      return await this.fetch(`/session/${sessionId}/unrevert`, {
        method: 'POST',
      });
    } catch {
      return null;
    }
  }

  async respondPermission(sessionID: string, permissionId: string, response: string, remember?: boolean): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/session/${sessionID}/permissions/${permissionId}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ response, remember: remember ?? false }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    try {
      await this.fetch(`/session/${sessionId}/abort`, { method: 'POST' });
    } catch {
      // ignore
    }
  }

  async grantPermission(sessionID: string, permissionId: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/session/${sessionID}/permissions/${permissionId}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader },
        body: JSON.stringify({ response: 'always', remember: true }),
      });
      if (response.ok) {
      } else {
        const text = await response.text();
        console.error('[opencode] Permission grant failed:', response.status, text.slice(0, 200));
      }
    } catch (err: any) {
      console.error('[opencode] Failed to grant permission:', err?.message);
    }
  }

  async postMessage(sessionId: string, body: Record<string, any>, signal?: AbortSignal): Promise<Response> {
    const url = `${this.baseUrl}/session/${sessionId}/message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    return response;
  }
}