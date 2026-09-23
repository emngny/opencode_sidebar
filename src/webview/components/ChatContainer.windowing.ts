export const DEFAULT_VISIBLE_MESSAGE_COUNT = 50;
export const MESSAGE_WINDOW_BATCH_SIZE = 50;

export function expandVisibleCount(current: number, total: number): number {
  return Math.min(current + MESSAGE_WINDOW_BATCH_SIZE, total);
}

export function getVisibleWindow<T>(messages: T[], visibleCount: number): {
  messages: T[];
  hiddenCount: number;
  hasMore: boolean;
} {
  const boundedCount = Math.max(0, visibleCount);
  const start = Math.max(0, messages.length - boundedCount);

  return {
    messages: messages.slice(start),
    hiddenCount: start,
    hasMore: start > 0,
  };
}
