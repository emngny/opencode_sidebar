export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  id?: string;
  isStreaming?: boolean;
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

export interface WebviewToExtensionMessage {
  type:
    | 'sendMessage'
    | 'acceptReview'
    | 'rejectReview'
    | 'clearChat'
    | 'abort'
    | 'getSessions'
    | 'listProviders'
    | 'setApiKey'
    | 'removeApiKey';
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
    | 'sessionList'
    | 'error'
    | 'providerList'
    | 'providerUpdated';
  payload?: any;
}

export interface ReviewItem {
  id: string;
  originalUri: string;
  previewUri: string;
  filename: string;
  inserts: number;
  deletes: number;
}
