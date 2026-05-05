export function calculateDiffStats(original: string, modified: string): { inserts: number; deletes: number } {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  let inserts = 0;
  let deletes = 0;
  let i = 0, j = 0;

  while (i < origLines.length && j < modLines.length) {
    if (origLines[i] === modLines[j]) {
      i++;
      j++;
    } else {
      // Simple heuristic diff
      if (i + 1 < origLines.length && origLines[i + 1] === modLines[j]) {
        deletes++;
        i++;
      } else if (j + 1 < modLines.length && origLines[i] === modLines[j + 1]) {
        inserts++;
        j++;
      } else {
        deletes++;
        inserts++;
        i++;
        j++;
      }
    }
  }

  deletes += origLines.length - i;
  inserts += modLines.length - j;

  return { inserts, deletes };
}
