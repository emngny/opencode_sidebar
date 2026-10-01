import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CommandItem, BUILTIN_COMMANDS, getCommandColor, needsAgent } from '../slashCommands';
import { COLORS, FONT_SIZE, RADIUS, popupPanel } from '../styles';
import { useEscapeToClose } from '../hooks/useFocusTrap';

/** Id of the listbox, referenced by the input's `aria-controls`. */
export const SLASH_LISTBOX_ID = 'slash-command-listbox';

/** Id of the option at `index`, referenced by the input's `aria-activedescendant`. */
export function slashOptionId(index: number): string {
  return `${SLASH_LISTBOX_ID}-option-${index}`;
}

interface Props {
  filter: string;
  skills: Array<{ name: string; description?: string }>;
  /**
   * Chat modes the server actually offers. Agent-bearing builtins the server
   * does not list are dropped rather than shown: selecting one would switch to a
   * mode the server has never heard of, and the next reconcile would switch back.
   */
  agents: string[];
  onSelect: (cmd: CommandItem) => void;
  onClose: () => void;
  /**
   * The focused text input. This list is anchored to it and must not steal
   * focus, so the highlight is bridged with `aria-activedescendant` instead.
   */
  comboboxRef?: React.RefObject<HTMLTextAreaElement>;
}

export function SlashCommandPopup({ filter, skills, agents, onSelect, onClose, comboboxRef }: Readonly<Props>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const popupRef = useRef<HTMLDivElement>(null);
  const agentsLoaded = agents.length > 0;

  const items: CommandItem[] = [
    // Before the server answers, a mode-switching command cannot be routed, so
    // only the local ones are offered instead of a list that would do nothing.
    ...BUILTIN_COMMANDS.filter((c) => !needsAgent(c) || (agentsLoaded && agents.includes(c.agent!))),
    ...skills.map((s) => ({
      type: 'skill' as const,
      command: s.name,
      label: s.name,
      description: s.description || 'Skill instructions',
      skillName: s.name,
    })),
  ];

  const filtered = filter ? items.filter((c) => c.command.toLowerCase().startsWith(filter.toLowerCase())) : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
      }
    },
    [filtered, selectedIndex, onSelect],
  );

  useEscapeToClose(true, onClose);

  useEffect(() => {
    if (filtered.length === 0) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, filtered.length]);

  // Point the input at the highlighted option so screen readers announce the
  // highlight without moving focus out of the text field.
  useEffect(() => {
    const input = comboboxRef?.current;
    if (!input) return;
    if (filtered.length === 0) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    input.setAttribute('aria-activedescendant', slashOptionId(selectedIndex));
  }, [comboboxRef, filtered.length, selectedIndex]);

  // Scroll selected into view
  useEffect(() => {
    const el = popupRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={popupRef}
      id={SLASH_LISTBOX_ID}
      role="listbox"
      aria-label="Commands and skills"
      style={{
        ...popupPanel,
        left: 16,
        right: 16,
        maxHeight: 280,
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          borderBottom: `1px solid ${COLORS.bgHover}`,
          fontSize: 11,
          color: COLORS.textDim,
        }}
      >
        Commands &amp; Skills
      </div>
      {filtered.map((cmd, i) => {
        const color = getCommandColor(cmd);
        const isSelected = i === selectedIndex;
        return (
          <div
            key={`${cmd.type}_${cmd.command}`}
            id={slashOptionId(i)}
            data-index={i}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => {
              setSelectedIndex(i);
              setHoveredIndex(i);
            }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: isSelected ? COLORS.bgHover : 'transparent',
              transition: 'background-color 0.1s',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color?.text || COLORS.textDim,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 500 }}>
                <span style={{ color: color?.text || COLORS.textDim }}>/{cmd.command}</span>
                {cmd.type === 'skill' && (
                  <span style={{ fontSize: FONT_SIZE.xs, color: COLORS.textDim, marginLeft: 6, fontWeight: 400 }}>
                    skill
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: COLORS.textDim,
                  marginTop: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cmd.description}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
