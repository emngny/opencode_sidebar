import { COLORS, withAlpha } from '../styles';

interface AgentColor {
  bg: string;
  text: string;
  border: string;
}

// Agent hues (matching Opencode Desktop). Only some sit in the app palette —
// the rest are deliberately off it, because collapsing every agent onto a
// palette token would make plan/code/review indistinguishable in the
// transcript. What is tokenised is the surrounding chrome.
const AGENT_HUES: Record<string, string> = {
  build: COLORS.accent,
  plan: '#f5c2e7',
  ask: COLORS.green,
  debug: COLORS.yellow,
  docs: COLORS.teal,
  code: '#cba6f7',
  review: '#fab387',
};

const FALLBACK_HUES = ['#bac2de', COLORS.teal, COLORS.red, COLORS.yellow];

/** Wash and hairline derive from the hue, so the three can never drift apart. */
function chip(hue: string): AgentColor {
  return { bg: withAlpha(hue, 0.12), text: hue, border: withAlpha(hue, 0.3) };
}

export function getAgentColor(agent?: string) {
  if (!agent) return null;
  const key = agent.toLowerCase();
  if (AGENT_HUES[key]) return chip(AGENT_HUES[key]);
  // Hash-based fallback for unknown agents
  const hash = key.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return chip(FALLBACK_HUES[hash % FALLBACK_HUES.length]);
}
