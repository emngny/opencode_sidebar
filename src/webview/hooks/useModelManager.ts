import { useState, useCallback, useEffect, useRef } from 'react';
import { GitInfo, ProviderListResult, ContextPart } from '../../extension/types';
import { postMessage } from '../vscode-api';
import { CommandItem } from '../slashCommands';

export interface ModelItem {
  id: string;
  name: string;
  providerId: string;
}

export function useModelManager() {
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('Build');
  const [gitInfo, setGitInfo] = useState<GitInfo>({
    branch: 'main',
    lastCommitTime: 'a minute ago',
    projectPath: 'C:/Projects/opencode_sidebar',
  });
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]);
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>({});
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [revertActive, setRevertActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [readPermissionPrompt, setReadPermissionPrompt] = useState<{ filePath: string; reason: string; requestId: string } | null>(null);
  const [showProviders, setShowProviders] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  const pendingRevertRef = useRef<string | null>(null);

  useEffect(() => {
    if (model) {
      postMessage({ type: 'saveModel', payload: { model } });
    }
  }, [model]);

  const toggleModelVisibility = useCallback((modelId: string) => {
    setHiddenModels((prev) => ({ ...prev, [modelId]: !prev[modelId] }));
  }, []);

  const handleToggleAllModels = useCallback((providerId: string, show: boolean) => {
    setHiddenModels((prev) => {
      const next = { ...prev };
      for (const m of availableModels) {
        if (m.providerId === providerId) {
          if (show) delete next[m.id];
          else next[m.id] = true;
        }
      }
      return next;
    });
  }, [availableModels]);

  const processProviderList = useCallback((result: ProviderListResult) => {
    const all = result.all || [];
    const conn = result.connected || [];
    const models: ModelItem[] = [];
    for (const provider of all) {
      if (conn.includes(provider.id)) {
        for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
          models.push({
            id: `${provider.id}/${modelId}`,
            name: (modelInfo as any).name || modelId,
            providerId: provider.id,
          });
        }
      }
    }
    models.sort((a, b) => {
      const aIsPinned = a.providerId === 'opencode' || a.providerId === 'opencode-go' ? 0 : 1;
      const bIsPinned = b.providerId === 'opencode' || b.providerId === 'opencode-go' ? 0 : 1;
      if (aIsPinned !== bIsPinned) return aIsPinned - bIsPinned;
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
      return a.name.localeCompare(b.name);
    });

    setAvailableModels(models);
    setProvidersLoaded(true);
  }, []);

  const tryAutoSelectModel = useCallback((models: ModelItem[], currentModel: string, hidden: Record<string, boolean>) => {
    if (!currentModel) {
      const visible = models.filter((m) => !hidden[m.id]);
      if (visible.length > 0) {
        setModel(visible[0].id);
      }
    }
  }, []);

  return {
    model, setModel, mode, setMode,
    gitInfo, setGitInfo,
    availableModels, setAvailableModels,
    hiddenModels, setHiddenModels,
    providersLoaded, setProvidersLoaded,
    skills, setSkills,
    fileSearchResults, setFileSearchResults,
    fileSearchQuery, setFileSearchQuery,
    revertActive, setRevertActive,
    confirmDialog, setConfirmDialog,
    readPermissionPrompt, setReadPermissionPrompt,
    showProviders, setShowProviders,
    showSessions, setShowSessions,
    pendingRevertRef,
    toggleModelVisibility, handleToggleAllModels,
    processProviderList, tryAutoSelectModel,
  };
}
