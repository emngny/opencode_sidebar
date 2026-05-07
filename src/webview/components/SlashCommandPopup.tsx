import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CommandItem, BUILTIN_COMMANDS, getCommandColor } from '../slashCommands';

interface Props {
  filter: string;
  skills: Array<{ name: string; description?: string }>;
  onSelect: (cmd: CommandItem) => void;
  onClose: () => void;
}

export function SlashCommandPopup({ filter, skills, onSelect, onClose }: Readonly<Props>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const popupRef = useRef<HTMLDivElement>(null);

  const items: CommandItem[] = [
    ...BUILTIN_COMMANDS,
    ...skills.map((s) => ({
      type: 'skill' as const,
      command: s.name,
      label: s.name,
      description: s.description || 'Skill instructions',
      skillName: s.name,
    })),
  ];

  const filtered = filter
    ? items.filter((c) => c.command.toLowerCase().startsWith(filter.toLowerCase()))
    : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (filtered.length === 0) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, filtered.length]);

  // Scroll selected into view
  useEffect(() => {
    const el = popupRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 16,
        right: 16,
        maxHeight: 280,
        overflowY: 'auto',
        backgroundColor: '#1e1e2e',
        border: '1px solid #45475a',
        borderRadius: 12,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        zIndex: 100,
      }}
    >
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #313244', fontSize: 11, color: '#6c7086' }}>
        Commands &amp; Skills
      </div>
      {filtered.map((cmd, i) => {
        const color = getCommandColor(cmd);
        const isSelected = i === selectedIndex;
        return (
          <div
            key={`${cmd.type}_${cmd.command}`}
            data-index={i}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => { setSelectedIndex(i); setHoveredIndex(i); }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: isSelected ? '#313244' : 'transparent',
              transition: 'background-color 0.1s',
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: color?.text || '#6c7086',
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#cdd6f4', fontWeight: 500 }}>
                <span style={{ color: color?.text || '#6c7086' }}>/{cmd.command}</span>
                {cmd.type === 'skill' && (
                  <span style={{ fontSize: 10, color: '#6c7086', marginLeft: 6, fontWeight: 400 }}>skill</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#6c7086', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cmd.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
