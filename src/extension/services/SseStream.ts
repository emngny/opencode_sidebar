export interface SSEMessage {
  id: string;
  type: string;
  properties: any;
}

export type EventCallback = (event: SSEMessage) => void;

export class SseStream {
  async connect(
    url: string,
    headers: Record<string, string>,
    onEvent: EventCallback,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const response = await fetch(url, { headers, signal });
      await this.parse(response, onEvent);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(`[opencode:sse] ${url} error:`, err?.message);
      }
    }
  }

  async parse(response: Response, onEvent: EventCallback): Promise<void> {
    try {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              onEvent(JSON.parse(line.slice(6)) as SSEMessage);
            } catch {
              // skip parse error
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[opencode:sse-stream] Error:', err?.message);
      }
    }
  }
}