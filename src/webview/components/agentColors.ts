// Agent color palette (matching Opencode Desktop)
const AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  build:   { bg: 'rgba(137, 180, 250, 0.12)', text: '#89b4fa', border: 'rgba(137, 180, 250, 0.3)' },
  plan:    { bg: 'rgba(245, 194, 231, 0.12)', text: '#f5c2e7', border: 'rgba(245, 194, 231, 0.3)' },
  ask:     { bg: 'rgba(166, 227, 161, 0.12)', text: '#a6e3a1', border: 'rgba(166, 227, 161, 0.3)' },
  debug:   { bg: 'rgba(249, 226, 175, 0.12)', text: '#f9e2af', border: 'rgba(249, 226, 175, 0.3)' },
  docs:    { bg: 'rgba(148, 226, 213, 0.12)', text: '#94e2d5', border: 'rgba(148, 226, 213, 0.3)' },
  code:    { bg: 'rgba(203, 166, 247, 0.12)', text: '#cba6f7', border: 'rgba(203, 166, 247, 0.3)' },
  review:  { bg: 'rgba(250, 179, 135, 0.12)', text: '#fab387', border: 'rgba(250, 179, 135, 0.3)' },
};

const FALLBACK_COLORS = [
  { bg: 'rgba(186, 194, 222, 0.12)', text: '#bac2de', border: 'rgba(186, 194, 222, 0.3)' },
  { bg: 'rgba(148, 226, 213, 0.12)', text: '#94e2d5', border: 'rgba(148, 226, 213, 0.3)' },
  { bg: 'rgba(243, 139, 168, 0.12)', text: '#f38ba8', border: 'rgba(243, 139, 168, 0.3)' },
  { bg: 'rgba(249, 226, 175, 0.12)', text: '#f9e2af', border: 'rgba(249, 226, 175, 0.3)' },
];

export function getAgentColor(agent?: string) {
  if (!agent) return null;
  const key = agent.toLowerCase();
  if (AGENT_COLORS[key]) return AGENT_COLORS[key];
  // Hash-based fallback for unknown agents
  const hash = key.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
