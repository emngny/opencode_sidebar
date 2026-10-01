import { ChatMessage } from '../../shared/types';

/**
 * Collapses repeated `file_edit` cards for the same path into one.
 *
 * A turn that touches a file several times produces one card per edit, and the
 * live stream interleaves each with its own `edit completed` tool result, so the
 * cards are never adjacent. Showing the path three times reads as three
 * separate changes and hides the total, so the group carries the summed
 * `added`/`deleted` instead.
 *
 * Grouping stops at a user message: a file edited in turn 1 and turn 5 belongs
 * to two different moments, and folding them into one card would erase when the
 * change happened. Assistant messages are deliberately *not* a boundary — they
 * interleave with tool events and treating them as one would leave the repeated
 * cards unmerged, which is the very case this fixes.
 *
 * The first card's patch is kept so `DiffPreview` still has something to show.
 * Patches cannot be concatenated: applying one shifts the line numbers the next
 * one refers to, so a merged patch would render against the wrong lines. The
 * summed counts are order-independent and therefore safe.
 */
export function groupFileEdits(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  /** Index in `out` of the group currently collecting edits for a path. */
  const openGroup = new Map<string, number>();
  let groupCount = 0;

  for (const message of messages) {
    if (message.role === 'user') {
      openGroup.clear();
      out.push(message);
      continue;
    }

    const path = message.role === 'event' && message.eventType === 'file_edit' ? message.eventMeta?.path : undefined;
    if (!path) {
      out.push(message);
      continue;
    }

    const openIndex = openGroup.get(path);
    if (openIndex === undefined) {
      openGroup.set(path, out.length);
      out.push(message);
      continue;
    }

    const head = out[openIndex];
    const added = (head.eventMeta?.added ?? 0) + (message.eventMeta?.added ?? 0);
    const deleted = (head.eventMeta?.deleted ?? 0) + (message.eventMeta?.deleted ?? 0);
    groupCount += 1;
    out[openIndex] = {
      ...head,
      eventMeta: { ...head.eventMeta, added, deleted },
      fileEditCount: (head.fileEditCount ?? 1) + 1,
    };
  }

  return groupCount > 0 || out.length !== messages.length ? out : [...messages];
}
