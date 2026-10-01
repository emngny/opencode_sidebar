// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { groupFileEdits } from './fileEditGroups';
import { ChatMessage } from '../../shared/types';

const edit = (path: string, added: number, deleted: number, id = `${path}-${added}`): ChatMessage =>
  ({
    id,
    role: 'event',
    content: path,
    eventType: 'file_edit',
    eventStatus: 'completed',
    eventMeta: { path, added, deleted, content: `+${added}` },
  }) as ChatMessage;

const user = (id: string): ChatMessage => ({ id, role: 'user', content: id, timestamp: 0 });

const tool = (id: string): ChatMessage =>
  ({ id, role: 'event', content: 'edit completed', eventType: 'tool_result', eventStatus: 'completed' }) as ChatMessage;

const assistant = (id: string): ChatMessage => ({ id, role: 'assistant', content: id, timestamp: 0 });

describe('groupFileEdits', () => {
  it('merges repeated edits to one path within a turn and sums the counts', () => {
    const merged = groupFileEdits([edit('a.ts', 3, 0), edit('a.ts', 2, 1), edit('a.ts', 1, 0, 'c')]);

    expect(merged).toHaveLength(1);
    expect(merged[0].eventMeta).toMatchObject({ path: 'a.ts', added: 6, deleted: 1 });
    expect(merged[0].fileEditCount).toBe(3);
  });

  it('merges even when tool and assistant messages sit between the edits', () => {
    // This is the real stream shape: each edit is followed by its own tool
    // result, so the cards are never adjacent and adjacency-based merging
    // cannot fire.
    const merged = groupFileEdits([
      tool('t1'),
      edit('a.ts', 1, 0),
      tool('t2'),
      assistant('say'),
      edit('a.ts', 2, 0, 'a2'),
      tool('t3'),
      edit('a.ts', 3, 0, 'a3'),
    ]);

    expect(merged.filter((m) => m.eventType === 'file_edit')).toHaveLength(1);
    expect(merged.find((m) => m.eventType === 'file_edit')?.eventMeta?.added).toBe(6);
  });

  it('keeps different paths apart', () => {
    // a.ts folds into one card, b.ts stays separate: two paths, two cards.
    const merged = groupFileEdits([edit('a.ts', 1, 0), edit('b.ts', 2, 0), edit('a.ts', 3, 0, 'a2')]);

    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.eventMeta?.path)).toEqual(['a.ts', 'b.ts']);
    expect(merged[0].eventMeta?.added).toBe(4);
    expect(merged[1].eventMeta?.added).toBe(2);
  });

  it('does not merge across a user message', () => {
    // A file edited in turn 1 and turn 5 belongs to two moments; folding them
    // together would erase when the change happened.
    const merged = groupFileEdits([user('turn1'), edit('a.ts', 1, 0), user('turn2'), edit('a.ts', 2, 0, 'a2')]);

    expect(merged).toHaveLength(4);
    expect(merged[1].eventMeta?.added).toBe(1);
    expect(merged[3].eventMeta?.added).toBe(2);
  });

  it('leaves non-edit events untouched', () => {
    const input = [tool('t1'), assistant('say'), user('turn'), tool('t2')];
    const output = groupFileEdits(input);

    expect(output).toEqual(input);
  });

  it('keeps the first patch so DiffPreview still has content', () => {
    const merged = groupFileEdits([edit('a.ts', 1, 0, 'first'), edit('a.ts', 2, 0, 'second')]);

    expect(merged[0].eventMeta?.content).toBe('+1');
    expect(merged[0].id).toBe('first');
  });

  it('does not mutate its input', () => {
    const original = edit('a.ts', 1, 0);
    const snapshot = JSON.parse(JSON.stringify(original));

    groupFileEdits([original, edit('a.ts', 5, 0, 'other')]);

    expect(original).toEqual(snapshot);
  });

  it('returns a copy when there is nothing to merge', () => {
    const input = [user('turn'), assistant('say')];
    const output = groupFileEdits(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});
