/**
 * Server-Sent Events message from the opencode server.
 */
export interface SSEMessage {
  id: string;
  type: string;
  properties: any;
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
      } catch (err: any) {
        if (err.name === 'AbortError' || signal.aborted) break;

        attempt++;
        if (attempt >= this.maxRetries) {
          console.error(`[opencode:sse] ${url} failed after ${attempt} attempts:`, err?.message);
          break;
        }

        const delay = this.baseRetryDelay * Math.pow(2, attempt - 1);
        console.warn(`[opencode:sse] ${url} disconnected, retrying in ${delay}ms (attempt ${attempt}/${this.maxRetries})`);
        await this.sleep(delay, signal);
      }
    }
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

  async parse(response: Response, onEvent: EventCallback, signal: AbortSignal): Promise<void> {
    try {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastEventId: string | undefined;
      let currentEvent: Partial<SseEvent> = {};

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line === '' && currentEvent.data) {
            try {
              onEvent(JSON.parse(currentEvent.data) as SSEMessage);
            } catch {
              // skip parse error
            }
            currentEvent = {};
            continue;
          }

          const event = this.parseEventLine(line);
          if (!event) continue;

          if (event.event !== undefined) {
            currentEvent.event = event.event;
          }
          if (event.id !== undefined) {
            lastEventId = event.id;
            currentEvent.id = event.id;
          }
          if (event.data !== undefined) {
            currentEvent.data = (currentEvent.data || '') + event.data;
          }
        }
      }

      if (currentEvent.data) {
        try {
          onEvent(JSON.parse(currentEvent.data) as SSEMessage);
        } catch {
          // skip parse error
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[opencode:sse-stream] Error:', err?.message);
      }
    }
  }
}