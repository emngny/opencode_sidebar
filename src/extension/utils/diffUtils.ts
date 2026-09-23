import { RawDiff, isRecord } from '../../shared/types';

export interface NormalizedDiff {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

export function normalizeDiff(d: unknown): NormalizedDiff {
  const rec: RawDiff = isRecord(d) ? (d as RawDiff) : {};
  const path = typeof rec.path === 'string' ? rec.path : typeof rec.file === 'string' ? rec.file : '';
  const content = typeof rec.content === 'string' ? rec.content : typeof rec.patch === 'string' ? rec.patch : '';
  let added = typeof rec.added === 'number' ? rec.added : 0;
  let deleted = typeof rec.deleted === 'number' ? rec.deleted : 0;
  if (added === 0 && deleted === 0 && content) {
    for (const line of content.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) deleted++;
    }
  }
  return { path, added, deleted, content };
}
