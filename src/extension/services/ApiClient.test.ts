import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './ApiClient';

describe('ApiClient', () => {
  it('does not expose server response details in thrown errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('internal database password=secret'),
      }),
    );
    const client = new ApiClient({ baseUrl: 'http://localhost:1234', authHeader: {} });

    await expect((client as any).fetch('/session/private')).rejects.toThrow('OpenCode API request failed (HTTP 500)');
  });

  it.each([
    ['deleteSession', (client: ApiClient) => client.deleteSession('session-1')],
    ['revertSession', (client: ApiClient) => client.revertSession('session-1', 'message-1')],
    ['unrevertSession', (client: ApiClient) => client.unrevertSession('session-1')],
  ])('propagates %s failures', async (_name, request) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, text: vi.fn() }));
    const client = new ApiClient({ baseUrl: 'http://localhost:1234', authHeader: {} });

    await expect(request(client)).rejects.toThrow('OpenCode API request failed (HTTP 409)');
  });

  it('requires a successful message refresh after a mutation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, text: vi.fn() }));
    const client = new ApiClient({ baseUrl: 'http://localhost:1234', authHeader: {} });

    await expect(client.getSessionMessagesStrict('session-1')).rejects.toThrow('HTTP 503');
  });

  it('reads each agent mode from GET /agent', async () => {
    // Shape observed on opencode 1.18: every entry carries the mode opencode
    // resolves for it, which decides whether it can own a session.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => [
          { name: 'build', mode: 'subagent' },
          { name: 'Prometheus - Plan Builder', mode: 'primary' },
          { name: 'plan', mode: 'subagent' },
        ],
      }),
    );
    const client = new ApiClient({ baseUrl: 'http://localhost:1234', authHeader: {} });

    await expect(client.getAgents()).resolves.toEqual([
      { id: 'build', mode: 'subagent' },
      { id: 'Prometheus - Plan Builder', mode: 'primary' },
      { id: 'plan', mode: 'subagent' },
    ]);
  });
});
