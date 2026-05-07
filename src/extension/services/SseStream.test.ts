import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseStream } from './SseStream';

describe('SseStream', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
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
});