import { getAgentColor } from './components/agentColors';
import { withAlpha } from './styles';
import type { CommandSummary } from '../shared/types';

export interface CommandItem {
  type: 'command' | 'skill';
  command: string;
  label: string;
  description: string;
  agent?: string;
  skillName?: string;
}

/**
 * True when picking this command switches the chat mode. `/new` and `/init` are
 * local actions, `/review` only needs an agent when it is given text to review —
 * so those must not be hidden just because the mode they would switch to is not
 * one the server offers.
 */
export function needsAgent(cmd: CommandItem): boolean {
  if (cmd.type === 'skill') return false;
  if (cmd.command === 'new' || cmd.command === 'init') return false;
  return Boolean(cmd.agent);
}

/**
 * Commands this extension implements itself, independent of the server.
 *
 * Everything else comes from `GET /command`. This list deliberately holds only
 * behaviour that lives in the extension — a fresh session, the `AGENTS.md`
 * scaffold — and no agent-named entries: a hard-coded `plan`/`build`/`ask`
 * cannot know what the server calls its modes, and offering one the server
 * never heard of produced a command that silently did nothing.
 */
export const BUILTIN_COMMANDS: CommandItem[] = [
  {
    type: 'command',
    command: 'new',
    label: 'New',
    description: 'Start a fresh chat session',
  },
  {
    type: 'command',
    command: 'init',
    label: 'Init',
    description: 'Guided AGENTS.md setup for the workspace',
  },
];

/**
 * Builds the picker list from the server's command index.
 *
 * Server entries win over the local builtins of the same name, so `init` and
 * `review` resolve to the richer server template instead of the extension's
 * thinner local behaviour. `/new` is the exception: it is a local action that
 * resets the session, and a server command of that name would not do that. It
 * replaces any same-named server entry rather than being added beside it, which
 * otherwise put two identical `/new` rows in the picker.
 */
export function buildCommandItems(
  commands: CommandSummary[],
  skills: Array<{ name: string; description?: string }>,
): CommandItem[] {
  const items: CommandItem[] = [];
  const added = new Set<string>();

  for (const command of commands) {
    if (command.name === 'new') continue;
    if (added.has(command.name)) continue;
    added.add(command.name);
    items.push({
      type: command.source === 'skill' ? 'skill' : 'command',
      command: command.name,
      label: command.name,
      description: command.description || (command.source === 'skill' ? 'Skill instructions' : 'Command'),
      agent: command.agent,
      skillName: command.source === 'skill' ? command.name : undefined,
    });
  }

  for (const skill of skills) {
    if (added.has(skill.name)) continue;
    added.add(skill.name);
    items.push({
      type: 'skill',
      command: skill.name,
      label: skill.name,
      description: skill.description || 'Skill instructions',
      skillName: skill.name,
    });
  }

  for (const builtin of BUILTIN_COMMANDS) {
    if (added.has(builtin.command)) continue;
    added.add(builtin.command);
    items.push(builtin);
  }

  return items;
}

export function getCommandColor(cmd: CommandItem): { bg: string; text: string; border: string } | null {
  if (cmd.type === 'skill') {
    const hue = '#cba6f7';
    return { bg: withAlpha(hue, 0.1), text: hue, border: withAlpha(hue, 0.3) };
  }
  if (cmd.agent) {
    return getAgentColor(cmd.agent);
  }
  return null;
}
