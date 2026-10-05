import { useState, useCallback, useEffect, useRef } from 'react';
import { CommandSummary, GitInfo, ProviderListResult } from '../../shared/types';
import { getPersistedState, postMessage, setPersistedState } from '../vscode-api';
import { buildModelItems, ModelItem, ModelSwitch, pickAutoSelectModel } from './modelUtils';

export type { ModelItem, ModelSwitch } from './modelUtils';

/** UI choices the user made that have to outlive a webview deallocation. */
interface PersistedUiState {
  mode?: string;
  hiddenModels?: Record<string, boolean>;
  showProviders?: boolean;
}

export function useModelManager() {
  // VS Code recreates the webview document when the view is hidden, so these
  // are read back from the state VS Code persisted for us. `model` is absent on
  // purpose: it already round-trips through the extension's workspaceState.
  const persisted = getPersistedState<PersistedUiState>();
  const [model, setModel] = useState('');
  // Left empty until the server names an agent. Defaulting to 'build' is a
  // guess: on this machine `build` is a subagent, not a chat mode, so the
  // reconciler would report it as unavailable and switch away from it on every
  // open — the visible symptom of a mode flip the user never asked for.
  const [mode, setMode] = useState(persisted.mode || '');
  const [gitInfo, setGitInfo] = useState<GitInfo>({
    branch: 'main',
    lastCommitTime: 'a minute ago',
    projectPath: 'C:/Projects/opencode_sidebar',
  });
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]);
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});
  const [hiddenModels, setHiddenModels] = useState<Record<string, boolean>>(persisted.hiddenModels || {});
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description?: string }>>([]);
  // The server's full command index. Empty until the server answers, which is
  // why the picker falls back to the local builtins rather than rendering blank.
  const [commands, setCommands] = useState<CommandSummary[]>([]);
  const [fileSearchResults, setFileSearchResults] = useState<Array<{ name: string; path: string }>>([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [revertActive, setRevertActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [readPermissionPrompt, setReadPermissionPrompt] = useState<{
    filePath: string;
    reason: string;
    requestId: string;
  } | null>(null);
  const [showProviders, setShowProviders] = useState(persisted.showProviders === true);
  const [showSessions, setShowSessions] = useState(false);

  const pendingRevertRef = useRef<string | null>(null);
  const hiddenModelsRef = useRef<Record<string, boolean>>({});
  const modelRef = useRef('');

  useEffect(() => {
    hiddenModelsRef.current = hiddenModels;
    setPersistedState({ hiddenModels });
  }, [hiddenModels]);

  useEffect(() => {
    setPersistedState({ mode });
  }, [mode]);

  useEffect(() => {
    setPersistedState({ showProviders });
  }, [showProviders]);

  useEffect(() => {
    if (model) {
      modelRef.current = model;
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

  /**
   * Picks a usable model from a freshly loaded catalog. Replaces a saved model
   * that the server no longer exposes, otherwise leaves the current one alone.
   * Returns the switch so callers can surface it instead of silently swapping.
   */
  const tryAutoSelectModel = useCallback((models: ModelItem[]): ModelSwitch | null => {
    const from = modelRef.current;
    const next = pickAutoSelectModel(models, from, hiddenModelsRef.current);
    if (!next) return null;
    setModel(next);
    return { from, to: next };
  }, []);

  return {
    model,
    setModel,
    mode,
    setMode,
    gitInfo,
    setGitInfo,
    availableModels,
    setAvailableModels,
    agentModels,
    setAgentModels,
    hiddenModels,
    setHiddenModels,
    providersLoaded,
    setProvidersLoaded,
    skills,
    setSkills,
    commands,
    setCommands,
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
    hiddenModelsRef,
    toggleModelVisibility,
    handleToggleAllModels,
    processProviderList,
    tryAutoSelectModel,
  };
}
