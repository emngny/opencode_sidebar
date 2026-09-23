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
});
