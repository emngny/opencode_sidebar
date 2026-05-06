export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event';
  content: string;
  timestamp: number;
  id?: string;
  isStreaming?: boolean;
  eventType?: 'tool_call' | 'tool_result' | 'file_read' | 'file_edit' | 'thinking' | 'discovery' | 'compacting' | 'permission';
  eventStatus?: 'running' | 'completed' | 'failed';
  eventMeta?: {
    path?: string;
    added?: number;
    deleted?: number;
    name?: string;
    args?: any;
    result?: any;
    error?: string;
    sessionId?: string;
    description?: string;
    subagentType?: string;
    permId?: string;
    permSessionId?: string;
    patterns?: string[];
    permType?: string;
    content?: string;
  };
  agent?: string;
  modelId?: string;
  duration?: number;
  interrupted?: boolean;
  reasoning?: string;
}

export interface GitInfo {
  branch: string;
  lastCommitTime: string;
  projectPath: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  providerID?: string;
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
  };
  cost?: { input?: number; output?: number };
  limit?: { context?: number; input?: number; output?: number };
  status?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source?: string;
  env?: string[];
  key?: string;
  models?: Record<string, ProviderModel>;
}

export interface ProviderListResult {
  all: ProviderInfo[];
  connected: string[];
  default: Record<string, string>;
}

export interface FileAttachment {
  type: 'file';
  name: string;
  path: string;
}

export interface ImageAttachment {
  type: 'image';
  name: string;
  data: string;
  mimeType: string;
}

export type ContextPart = FileAttachment | ImageAttachment;

export interface WebviewToExtensionMessage {
  type:
    | 'sendMessage'
    | 'acceptReview'
    | 'rejectReview'
    | 'clearChat'
    | 'abort'
    | 'getSessions'
    | 'loadSession'
    | 'deleteSession'
    | 'switchAgent'
    | 'listProviders'
    | 'setApiKey'
    | 'removeApiKey'
    | 'searchFiles'
    | 'getSavedModel'
    | 'saveModel'
    | 'revertMessage'
    | 'unrevert'
    | 'respondPermission'
    | 'openDiff';
  payload?: any;
}

export interface ExtensionToWebviewMessage {
  type:
    | 'receiveMessage'
    | 'receiveChunk'
    | 'streamEnd'
    | 'reviewReady'
    | 'reviewResolved'
    | 'status'
    | 'gitInfo'
    | 'projectInfo'
    | 'sessionList'
    | 'sessionLoaded'
    | 'sessionDeleted'
    | 'agentList'
    | 'error'
    | 'providerList'
    | 'providerUpdated'
    | 'fileSearchResults'
    | 'savedModel'
    | 'toolEvent'
    | 'revertResult'
    | 'messageMeta'
    | 'reasoningContent';
  payload?: any;
}

export interface SessionDiffFile {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

export interface SessionDiff {
  sessionID: string;
  files: SessionDiffFile[];
}

export interface ProjectInfo {
  name: string;
  path: string;
  agent?: string;
}

export interface VcsInfo {
  branch?: string;
  commit?: string;
  message?: string;
  dirty?: boolean;
}

export interface PathInfo {
  path: string;
  project?: string;
}
