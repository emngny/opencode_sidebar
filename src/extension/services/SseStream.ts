import { randomInt } from 'node:crypto';

/**
 * Server-Sent Events message from the opencode server.
 */
export interface SSEMessage {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

export type EventCallback = (event: SSEMessage) => void;

interface SseEvent {
  data: string;
  event?: string;
  id?: string;
}

/**
 * Handles Server-Sent Events (SSE) streaming from the opencode server.
 * Used for both long-lived /event endpoint and POST response streams.
 */
export class SseStream {
  private maxRetries = 3;
  private baseRetryDelay = 1000;
  private maxRetryDelay = 30_000;

  async connect(
    url: string,
    headers: Record<string, string>,
    onEvent: EventCallback,
    signal: AbortSignal
  ): Promise<void> {
    let attempt = 0;

    while (!signal.aborted) {
      try {
        const response = await fetch(url, { headers, signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        await this.parse(response, onEvent, signal);
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError' || signal.aborted) break;

        attempt++;
        if (attempt >= this.maxRetries) {
          console.error(`[opencode:sse] ${url} failed after ${attempt} attempts:`, msg);
          break;
        }

        const delay = this.getRetryDelay(attempt);
        console.warn(`[opencode:sse] ${url} disconnected, retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`);
        await this.sleep(delay, signal);
      }
    }
  }

  private getRetryDelay(attempt: number): number {
    const exponentialDelay = Math.min(
      this.maxRetryDelay,
      this.baseRetryDelay * Math.pow(2, attempt - 1),
    );
    const halfDelay = exponentialDelay / 2;
    return Math.round(halfDelay + randomInt(0, exponentialDelay) / 2);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timeout = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private parseEventLine(line: string): SseEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trimStart();
      return { data };
    }

    if (trimmed.startsWith('event:')) {
      return { data: '', event: trimmed.slice(6).trim() };
    }

    if (trimmed.startsWith('id:')) {
      return { data: '', id: trimmed.slice(3).trim() };
    }

    if (trimmed.startsWith('retry:')) {
      const ms = parseInt(trimmed.slice(6).trim(), 10);
      if (!isNaN(ms)) this.baseRetryDelay = Math.max(1000, ms);
      return null;
    }

    if (trimmed.startsWith(':')) return null;

    return null;
  }

  private processSseLine(
    line: string,
    state: { lastEventId?: string; currentEvent: Partial<SseEvent> },
    onEvent: EventCallback,
  ): void {
    if (line === '' && state.currentEvent.data) {
      try {
        onEvent(JSON.parse(state.currentEvent.data) as SSEMessage);
      } catch {
        // skip parse error
      }
      state.currentEvent = {};
      return;
    }

    const event = this.parseEventLine(line);
    if (!event) return;

    if (event.event !== undefined) {
      state.currentEvent.event = event.event;
    }
    if (event.id !== undefined) {
      state.lastEventId = event.id;
      state.currentEvent.id = event.id;
    }
    if (event.data !== undefined) {
      // Each `data:` line is a complete JSON event in opencode's SSE.
      // If we already have buffered data, emit it first so
      // `data: {...}\ndata: {...}\n\n` yields two events (test expects this).
      if (state.currentEvent.data) {
        try {
          onEvent(JSON.parse(state.currentEvent.data) as SSEMessage);
        } catch {
          // skip parse error
        }
        state.currentEvent = {};
        if (state.lastEventId) state.currentEvent.id = state.lastEventId;
        if (event.event !== undefined) state.currentEvent.event = event.event;
      }
      state.currentEvent.data = (state.currentEvent.data || '') + event.data;
    }
  }

  async parse(response: Response, onEvent: EventCallback, signal: AbortSignal): Promise<void> {
    try {
      if (!response.body) throw new Error('SSE response has no body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const state: { lastEventId?: string; currentEvent: Partial<SseEvent> } = { currentEvent: {} };

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let lineEnd = buffer.indexOf('\n');
        while (lineEnd >= 0) {
          this.processSseLine(buffer.slice(0, lineEnd), state, onEvent);
          buffer = buffer.slice(lineEnd + 1);
          lineEnd = buffer.indexOf('\n');
        }
      }

      if (buffer) this.processSseLine(buffer, state, onEvent);
      if (state.currentEvent.data) {
        try {
          onEvent(JSON.parse(state.currentEvent.data) as SSEMessage);
        } catch {
          // skip parse error
        }
      }
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[opencode:sse-stream] Error:', msg);
        throw err;
      }
    }
  }
}