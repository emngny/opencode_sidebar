export interface NormalizedDiff {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

export function normalizeDiff(d: any): NormalizedDiff {
  const path = d.path || d.file || '';
  const content = d.content || d.patch || '';
  let added = typeof d.added === 'number' ? d.added : 0;
  let deleted = typeof d.deleted === 'number' ? d.deleted : 0;
  if (added === 0 && deleted === 0 && content) {
    for (const line of content.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) deleted++;
    }
  }
  return { path, added, deleted, content };
}