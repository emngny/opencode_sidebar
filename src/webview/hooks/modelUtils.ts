import { ProviderListResult, ProviderModel } from '../../shared/types';

export interface ModelItem {
  id: string;
  name: string;
  providerId: string;
}

/** A model change applied automatically because the saved model is gone. */
export interface ModelSwitch {
  from: string;
  to: string;
}

export function buildModelItems(result: ProviderListResult): ModelItem[] {
  const connected = new Set(result.connected || []);
  const models: ModelItem[] = [];

  for (const provider of result.all || []) {
    if (!connected.has(provider.id)) continue;
    for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
      const info = modelInfo as ProviderModel;
      models.push({
        id: `${provider.id}/${modelId}`,
        name: info.name || modelId,
        providerId: provider.id,
      });
    }
  }

  return models.sort((a, b) => {
    const aPinned = a.providerId === 'opencode' || a.providerId === 'opencode-go' ? 0 : 1;
    const bPinned = b.providerId === 'opencode' || b.providerId === 'opencode-go' ? 0 : 1;
    if (aPinned !== bPinned) return aPinned - bPinned;
    if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
    return a.name.localeCompare(b.name);
  });
}

export function pickAutoSelectModel(
  models: ModelItem[],
  currentModel: string,
  hidden: Record<string, boolean>,
): string | null {
  const visible = models.filter((model) => !hidden[model.id]);
  if (visible.length === 0) return null;
  // A saved model can disappear when the server refreshes its catalog.
  if (currentModel && visible.some((model) => model.id === currentModel)) return null;
  const next = visible[0].id;
  return next === currentModel ? null : next;
}

/**
 * Model to put on a request, or `''` to send none and let opencode decide.
 *
 * opencode resolves the active agent's own pin when a request carries no model,
 * and it is the only party that can do it correctly. So the model is left off
 * whenever that pin will actually work, which is the normal case.
 *
 * It is sent when the pin cannot work. `Sisyphus - ultraworker` is pinned to
 * `opencode-go/normal-combo`, which this server does not publish — the model
 * exists as `omniroute/normal-combo` — so a request that trusted the pin died
 * with `Model not found` on every turn. Sending the picker then is a fallback,
 * not an override: there is no working pin to defer to.
 *
 * A model the user picked outranks a resolvable pin either way, because opencode
 * also prefers the request model over the agent's own.
 */
export function resolvePromptModel(pinResolves: boolean, userChoseModel: boolean, pickedModel: string): string {
  if (pinResolves && !userChoseModel) return '';
  return pickedModel;
}

/**
 * The model an agent pins but the server's catalog does not contain, else null.
 *
 * Worth reporting rather than working around. opencode fails such a turn itself
 * with `Model not found`, and it fails identically in its own TUI — so the fix
 * belongs in the agent's configuration, not here. Silently substituting a
 * same-named model from another provider would hide a real misconfiguration
 * behind a turn that quietly runs something else.
 */
export function hasUnresolvablePin(
  agent: string,
  agentModels: Record<string, string>,
  availableModels: ModelItem[],
): string | null {
  const pinned = agentModels[agent];
  if (!pinned) return null;
  // An empty catalog means the answer is not known yet, not that every pin is
  // broken — reporting here would warn about all three agents on every open.
  if (availableModels.length === 0) return null;
  return availableModels.some((model) => model.id === pinned) ? null : pinned;
}
