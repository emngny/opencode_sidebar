import { getAgentColor } from './components/agentColors';

export interface CommandItem {
  type: 'command' | 'skill';
  command: string;
  label: string;
  description: string;
  agent?: string;
  skillName?: string;
}

export const BUILTIN_COMMANDS: CommandItem[] = [
  { type: 'command', command: 'init', label: 'Init', description: 'Guided AGENTS.md setup for the workspace', agent: 'build' },
  { type: 'command', command: 'review', label: 'Review', description: 'Review uncommitted changes', agent: 'review' },
  { type: 'command', command: 'plan', label: 'Plan', description: 'Read-only analysis and code exploration', agent: 'plan' },
  { type: 'command', command: 'build', label: 'Build', description: 'Full-access development agent', agent: 'build' },
  { type: 'command', command: 'ask', label: 'Ask', description: 'Quick questions about the codebase', agent: 'ask' },
  { type: 'command', command: 'debug', label: 'Debug', description: 'Debug issues and errors', agent: 'debug' },
  { type: 'command', command: 'docs', label: 'Docs', description: 'Generate and improve documentation', agent: 'docs' },
  { type: 'command', command: 'code', label: 'Code', description: 'Code quality review and suggestions', agent: 'code' },
];

export function getCommandColor(cmd: CommandItem): { bg: string; text: string; border: string } | null {
  if (cmd.type === 'skill') {
    return { bg: 'rgba(203,166,247,0.1)', text: '#cba6f7', border: 'rgba(203,166,247,0.3)' };
  }
  if (cmd.agent) {
    return getAgentColor(cmd.agent);
  }
  return null;
}
