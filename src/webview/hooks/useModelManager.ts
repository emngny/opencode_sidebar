import { useState, useCallback, useEffect, useRef } from 'react';
import { GitInfo, ProviderListResult } from '../../shared/types';
import { postMessage } from '../vscode-api';
import { buildModelItems, ModelItem, pickAutoSelectModel } from './modelUtils';

export type { ModelItem } from './modelUtils';

export function useModelManager() {
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('build');
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
  const [readPermissionPrompt, setReadPermissionPrompt] = useState<{
    filePath: string;
    reason: string;
    requestId: string;
  } | null>(null);
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

  const handleToggleAllModels = useCallback(
    (providerId: string, show: boolean) => {
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
    },
    [availableModels],
  );

  const processProviderList = useCallback((result: ProviderListResult) => {
    setAvailableModels(buildModelItems(result));
    setProvidersLoaded(true);
  }, []);

  const tryAutoSelectModel = useCallback(
    (models: ModelItem[], currentModel: string, hidden: Record<string, boolean>) => {
      const next = pickAutoSelectModel(models, currentModel, hidden);
      if (next) setModel(next);
    },
    [],
  );

  return {
    model,
    setModel,
    mode,
    setMode,
    gitInfo,
    setGitInfo,
    availableModels,
    setAvailableModels,
    hiddenModels,
    setHiddenModels,
    providersLoaded,
    setProvidersLoaded,
    skills,
    setSkills,
    fileSearchResults,
    setFileSearchResults,
    fileSearchQuery,
    setFileSearchQuery,
    revertActive,
    setRevertActive,
    confirmDialog,
    setConfirmDialog,
    readPermissionPrompt,
    setReadPermissionPrompt,
    showProviders,
    setShowProviders,
    showSessions,
    setShowSessions,
    pendingRevertRef,
    toggleModelVisibility,
    handleToggleAllModels,
    processProviderList,
    tryAutoSelectModel,
  };
}
