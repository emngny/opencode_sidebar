import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CommandItem, buildCommandItems, getCommandColor, needsAgent } from '../slashCommands';
import { COLORS, FONT_SIZE, popupPanel } from '../styles';
import { useEscapeToClose } from '../hooks/useFocusTrap';
import type { CommandSummary } from '../../shared/types';

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
   * Every command the server offers. A workspace-only scan misses the skills
   * installed in the global roots, so this list — not a local guess — is what
   * the picker shows.
   */
  commands?: CommandSummary[];
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

/** How many rows the picker renders before the user starts typing a filter. */
const MAX_VISIBLE_COMMANDS = 40;

/**
 * Whether a row matches the typed filter.
 *
 * A prefix match is what typing `/brain` means, but a 528-entry list is
 * unusable on prefix alone — `brainstorm-plan` only appears once the user has
 * typed past the divergence. Substring matching on the name and description
 * keeps every candidate reachable.
 */
function matchesFilter(cmd: CommandItem, filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  const name = cmd.command.toLowerCase();
  if (name.startsWith(needle)) return true;
  return name.includes(needle) || cmd.description.toLowerCase().includes(needle);
}

export function SlashCommandPopup({
  filter,
  skills,
  commands,
  agents,
  onSelect,
  onClose,
  comboboxRef,
}: Readonly<Props>) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const agentsLoaded = agents.length > 0;
  const serverCommands = commands || [];

  const items: CommandItem[] = useMemo(
    () =>
      buildCommandItems(serverCommands, skills).filter(
        (cmd) => !needsAgent(cmd) || (agentsLoaded && agents.includes(cmd.agent!)),
      ),
    // `agentsLoaded` is derived from `agents`, so listing it keeps the memo from
    // caching an empty result from the render before the server answered.
    [serverCommands, skills, agents, agentsLoaded],
  );

  const matched = useMemo(() => items.filter((c) => matchesFilter(c, filter)), [items, filter]);
  // Cap only the unfiltered view: once the user types, whatever matches is what
  // they are looking for and hiding the tail would hide the command they typed.
  const filtered = useMemo(() => (filter ? matched : matched.slice(0, MAX_VISIBLE_COMMANDS)), [filter, matched]);

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
            tabIndex={-1}
            aria-selected={isSelected}
            onClick={() => onSelect(cmd)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(cmd);
              }
            }}
            onMouseEnter={() => setSelectedIndex(i)}
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
