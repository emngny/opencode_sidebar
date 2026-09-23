import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomInt } from 'node:crypto';
import { SseStream } from './SseStream';

vi.mock('node:crypto', () => ({
  randomInt: vi.fn(() => 250),
}));

describe('SseStream', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('should parse data: lines', async () => {
    const encoder = new TextEncoder();
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {"type":"test","properties":{}}\n\n') })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const events: any[] = [];
    const stream = new SseStream();
    await stream.connect('http://localhost/event', {}, (e) => events.push(e), { aborted: false } as any);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('test');
  });

  it('parses events split across many small chunks', async () => {
    const encoder = new TextEncoder();
    const event = 'data: {"type":"test","properties":{"value":"' + 'x'.repeat(1000) + '"}}\n\n';
    const chunks = Array.from({ length: Math.ceil(event.length / 10) }, (_, index) => encoder.encode(event.slice(index * 10, (index + 1) * 10)));
    const mockReader = {
      read: vi.fn()
        .mockImplementation(async () => chunks.length > 0
          ? { done: false, value: chunks.shift() }
          : { done: true }),
    };
    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const events: any[] = [];
    await new SseStream().connect('http://localhost/event', {}, (e) => events.push(e), { aborted: false } as any);

    expect(events).toHaveLength(1);
    expect(events[0].properties.value).toHaveLength(1000);
  });

  it('should handle multi-line data', async () => {
    const encoder = new TextEncoder();
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {"type":"msg","properties":{"part":{"id":"1","type":"text"}}}\ndata: {"type":"msg","properties":{"part":{"id":"1","type":"text","result":"done"}}}\n\n') })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const events: any[] = [];
    const stream = new SseStream();
    await stream.connect('http://localhost/event', {}, (e) => events.push(e), { aborted: false } as any);

    expect(events).toHaveLength(2);
  });

  it('should handle event: prefix for event type', async () => {
    const encoder = new TextEncoder();
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('event: message\ndata: {"type":"test","properties":{}}\n\n') })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const events: any[] = [];
    const stream = new SseStream();
    await stream.connect('http://localhost/event', {}, (e) => events.push(e), { aborted: false } as any);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('test');
  });

  it('should handle retry: directive', async () => {
    const encoder = new TextEncoder();
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode('retry: 5000\ndata: {"type":"test","properties":{}}\n\n') })
        .mockResolvedValueOnce({ done: true }),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const stream = new SseStream();
    await stream.connect('http://localhost/event', {}, () => {}, { aborted: false } as any);
  });

  it('should retry on failure', async () => {
    const encoder = new TextEncoder();
    let attempts = 0;
    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) throw new Error('Connection reset');
        return { done: true };
      }),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });

    const stream = new SseStream();
    stream.maxRetries = 1;

    await stream.connect('http://localhost/event', {}, () => {}, { aborted: false } as any);
  });

  it('uses equal jitter with exponential backoff', async () => {
    mockFetch.mockRejectedValue(new Error('server unavailable'));
    vi.mocked(randomInt).mockImplementation((_min, max) => Math.floor(max * 0.25));
    const stream = new SseStream();
    const sleep = vi.spyOn(stream as any, 'sleep').mockResolvedValue(undefined);
    const signal = { aborted: false } as AbortSignal;

    await stream.connect('http://localhost/event', {}, () => {}, signal);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 625, signal);
    expect(sleep).toHaveBeenNthCalledWith(2, 1250, signal);
  });

  it('should reject a successful response without a body', async () => {
    const response = { ok: true, body: null } as Response;
    const stream = new SseStream();

    await expect(stream.parse(response, () => {}, new AbortController().signal))
      .rejects.toThrow('SSE response has no body');
  });
});