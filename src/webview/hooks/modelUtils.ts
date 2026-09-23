import { ProviderListResult, ProviderModel } from '../../shared/types';

export interface ModelItem {
  id: string;
  name: string;
  providerId: string;
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
  if (currentModel) return null;
  return models.find((model) => !hidden[model.id])?.id ?? null;
}
