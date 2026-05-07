import React, { useMemo } from 'react';

interface Props {
  additions: number;
  deletions: number;
  variant?: 'default' | 'bars';
}

const TOTAL_BLOCKS = 5;
const SMALL_DIFF_THRESHOLD = 5;
const MIN_BLOCKS_THRESHOLD = 20;
const RATIO_THRESHOLD = 4;
const SMALL_ADD_LIMIT = 5;
const SMALL_ADD_LIMIT_2 = 10;

export function DiffChanges({ additions, deletions, variant = 'default' }: Props) {
  const total = additions + deletions;

  const blocks = useMemo(() => {
    if (additions === 0 && deletions === 0) return Array(TOTAL_BLOCKS).fill('neutral');

    if (total < SMALL_DIFF_THRESHOLD) {
      const added = additions > 0 ? 1 : 0;
      const deleted = deletions > 0 ? 1 : 0;
      return [
        ...Array(added).fill('added'),
        ...Array(deleted).fill('deleted'),
        ...Array(TOTAL_BLOCKS - added - deleted).fill('neutral'),
      ];
    }

    const ratio = additions > deletions ? additions / deletions : deletions / additions;
    let blocksForColors = TOTAL_BLOCKS;
    if (total < MIN_BLOCKS_THRESHOLD || ratio < RATIO_THRESHOLD) blocksForColors = TOTAL_BLOCKS - 1;

    const percentAdded = additions / total;
    const percentDeleted = deletions / total;

    let added = additions > 0 ? Math.max(1, Math.round(percentAdded * blocksForColors)) : 0;
    let deleted = deletions > 0 ? Math.max(1, Math.round(percentDeleted * blocksForColors)) : 0;

    if (additions > 0 && additions <= SMALL_ADD_LIMIT) added = Math.min(added, 1);
    if (additions > SMALL_ADD_LIMIT && additions <= SMALL_ADD_LIMIT_2) added = Math.min(added, 2);
    if (deletions > 0 && deletions <= SMALL_ADD_LIMIT) deleted = Math.min(deleted, 1);
    if (deletions > SMALL_ADD_LIMIT && deletions <= SMALL_ADD_LIMIT_2) deleted = Math.min(deleted, 2);

    let totalAlloc = added + deleted;
    if (totalAlloc > blocksForColors) {
      if (percentAdded > percentDeleted) added = blocksForColors - deleted;
      else deleted = blocksForColors - added;
      totalAlloc = added + deleted;
    }

    const neutral = Math.max(0, TOTAL_BLOCKS - totalAlloc);
    return [
      ...Array(added).fill('added'),
      ...Array(deleted).fill('deleted'),
      ...Array(neutral).fill('neutral'),
    ];
  }, [additions, deletions, total]);

  const colors = { added: '#a6e3a1', deleted: '#f38ba8', neutral: '#585b70' };

  if (variant === 'bars') {
    return (
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
        {blocks.map((type, i) => (
          <rect key={i} x={i * 4} width="2" height="14" rx="1" fill={colors[type as keyof typeof colors]} />
        ))}
      </svg>
    );
  }

  return (
    <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
      <span style={{ color: '#a6e3a1' }}>+{additions}</span>
      <span style={{ color: '#585b70', margin: '0 4px' }}>/</span>
      <span style={{ color: '#f38ba8' }}>-{deletions}</span>
    </span>
  );
}
