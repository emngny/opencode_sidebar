import React, { createContext, useContext, ReactNode } from 'react';
import { useChatState } from './useChatState';
import { useModelManager } from './useModelManager';
import { ChatMessage, ProviderListResult } from '../../extension/types';

interface AppState {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  contextEvents: Array<{ id: string; name: string; status: string; content: string; meta?: any }>;
  setContextEvents: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; status: string; content: string; meta?: any }>>>;
  pendingChunkRef: React.MutableRefObject<string>;
  chunkFlushTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamingMsgIdRef: React.MutableRefObject<string | null>;
  DEBOUNCE_MS: number;
  flushPendingChunk: () => void;
  cleanupStreaming: () => void;
  model: string;
  setModel: React.Dispatch<React.SetStateAction<string>>;
  mode: string;
  setMode: React.Dispatch<React.SetStateAction<string>>;
  gitInfo: { branch: string; lastCommitTime: string; projectPath: string };
  setGitInfo: React.Dispatch<React.SetStateAction<{ branch: string; lastCommitTime: string; projectPath: string }>>;
  availableModels: Array<{ id: string; name: string; providerId: string }>;
  setAvailableModels: React.Dispatch<React.SetStateAction<Array<{ id: string; name: string; providerId: string }>>>;
  hiddenModels: Record<string, boolean>;
  setHiddenModels: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  providersLoaded: boolean;
  setProvidersLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  skills: Array<{ name: string; description?: string }>;
  setSkills: React.Dispatch<React.SetStateAction<Array<{ name: string; description?: string }>>>;
  fileSearchResults: Array<{ name: string; path: string }>;
  setFileSearchResults: React.Dispatch<React.SetStateAction<Array<{ name: string; path: string }>>>;
  fileSearchQuery: string;
  setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  revertActive: boolean;
  setRevertActive: React.Dispatch<React.SetStateAction<boolean>>;
  confirmDialog: { message: string; onConfirm: () => void } | null;
  setConfirmDialog: React.Dispatch<React.SetStateAction<{ message: string; onConfirm: () => void } | null>>;
  readPermissionPrompt: { filePath: string; reason: string; requestId: string } | null;
  setReadPermissionPrompt: React.Dispatch<React.SetStateAction<{ filePath: string; reason: string; requestId: string } | null>>;
  showProviders: boolean;
  setShowProviders: React.Dispatch<React.SetStateAction<boolean>>;
  showSessions: boolean;
  setShowSessions: React.Dispatch<React.SetStateAction<boolean>>;
  toggleModelVisibility: (modelId: string) => void;
  handleToggleAllModels: (providerId: string, show: boolean) => void;
  pendingRevertRef: React.MutableRefObject<string | null>;
  processProviderList: (result: ProviderListResult) => void;
  tryAutoSelectModel: (models: Array<{ id: string; name: string; providerId: string }>, currentModel: string, hidden: Record<string, boolean>) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const chatState = useChatState();
  const modelState = useModelManager();

  const state: AppState = {
    ...chatState,
    ...modelState,
  };

  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}