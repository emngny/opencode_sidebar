/**
 * Display-ready chat message with optional streaming and metadata.
 * Used for both user messages and assistant responses including tool events.
 */
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

/**
 * Git repository metadata for the current workspace.
 */
export interface GitInfo {
  branch: string;
  lastCommitTime: string;
  projectPath: string;
}

/**
 * Individual model from a provider with capabilities and pricing.
 */
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

/**
 * LLM provider with environment requirements and available models.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  source?: string;
  env?: string[];
  key?: string;
  models?: Record<string, ProviderModel>;
}

/**
 * List of all providers plus connection status and defaults.
 */
export interface ProviderListResult {
  all: ProviderInfo[];
  connected: string[];
  default: Record<string, string>;
}

/**
 * File attachment for context in a message.
 */
export interface FileAttachment {
  type: 'file';
  name: string;
  path: string;
}

/**
 * Image attachment for context in a message.
 */
export interface ImageAttachment {
  type: 'image';
  name: string;
  data: string;
  mimeType: string;
}

/**
 * Context parts that can be attached to a user message.
 */
export type ContextPart = FileAttachment | ImageAttachment;

interface SendMessagePayload {
  prompt: string;
  model?: string;
  mode?: string;
  context?: ContextPart[];
}

interface AcceptReviewPayload {
  accept: boolean;
}

interface ClearChatPayload {
  sessionId?: string;
}

interface LoadSessionPayload {
  sessionId: string;
}

interface DeleteSessionPayload {
  sessionId: string;
}

interface SwitchAgentPayload {
  agent: string;
}

interface SetApiKeyPayload {
  providerId: string;
  key: string;
}

interface RemoveApiKeyPayload {
  providerId: string;
}

interface SearchFilesPayload {
  query: string;
}

interface SaveModelPayload {
  model: string;
}

interface RevertMessagePayload {
  messageId: string;
}

interface UnrevertPayload {
  messageId: string;
  sessionId?: string;
}

interface RespondPermissionPayload {
  permId: string;
  permSessionId: string;
  response: 'allow' | 'deny';
  remember?: boolean;
}

interface RespondReadPermissionPayload {
  filePath: string;
  response: 'allow' | 'deny';
  remember?: boolean;
}

interface OpenDiffPayload {
  filePath: string;
}

interface RunCommandPayload {
  command: string;
  args?: string;
  isSkill?: boolean;
}

/**
 * All messages the webview sends to the extension.
 * Discriminated by `type` field for type-safe handling.
 */
export type WebviewToExtensionMessage =
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'acceptReview'; payload: AcceptReviewPayload }
  | { type: 'rejectReview'; payload: AcceptReviewPayload }
  | { type: 'clearChat'; payload?: ClearChatPayload }
  | { type: 'abort'; payload?: undefined }
  | { type: 'getSessions'; payload?: undefined }
  | { type: 'loadSession'; payload: LoadSessionPayload }
  | { type: 'deleteSession'; payload: DeleteSessionPayload }
  | { type: 'switchAgent'; payload: SwitchAgentPayload }
  | { type: 'listProviders'; payload?: undefined }
  | { type: 'setApiKey'; payload: SetApiKeyPayload }
  | { type: 'removeApiKey'; payload: RemoveApiKeyPayload }
  | { type: 'searchFiles'; payload: SearchFilesPayload }
  | { type: 'getSavedModel'; payload?: undefined }
  | { type: 'saveModel'; payload: SaveModelPayload }
  | { type: 'revertMessage'; payload: RevertMessagePayload }
  | { type: 'unrevert'; payload?: UnrevertPayload }
  | { type: 'respondPermission'; payload: RespondPermissionPayload }
  | { type: 'respondReadPermission'; payload: RespondReadPermissionPayload }
  | { type: 'openDiff'; payload: OpenDiffPayload }
  | { type: 'runCommand'; payload: RunCommandPayload }
  | { type: 'loadSkills'; payload?: undefined };

interface ReceiveMessagePayload {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event';
  content: string;
  timestamp?: number;
  id?: string;
  project?: string;
  reason?: string;
  [key: string]: unknown;
}

interface ReceiveChunkPayload {
  content: string;
  fullContent?: string;
}

interface StreamEndPayload {
  content: string;
}

interface GitInfoPayload extends GitInfo {}

interface SessionListPayload {
  id: string;
  name?: string;
  title?: string;
  updated?: string;
  time?: { created?: number; completed?: number };
  messageCount?: number;
}

interface SessionLoadedPayload {
  sessionId: string;
  messages: ChatMessage[];
}

interface SessionDeletedPayload {
  sessionId: string;
}

interface ErrorPayload {
  message: string;
  error?: string;
  [key: string]: unknown;
}

interface ProviderListPayload extends ProviderListResult {}

interface ProviderUpdatedPayload {
  providerId: string;
  success: boolean;
  removed?: boolean;
  error?: string;
}

interface FileSearchResultsPayload {
  query: string;
  files: { name: string; path: string; description?: string }[];
}

/**
 * Saved model configuration payload.
 */
export interface SavedModelPayload {
  model?: string;
  [key: string]: unknown;
}

interface ToolEventPayload {
  id?: string;
  type: string;
  name: string;
  status: string;
  content?: string;
  meta?: Record<string, unknown>;
}

interface RevertResultPayload {
  result: unknown;
  messages: unknown[];
  reverted: boolean;
}

interface MessageMetaPayload {
  id?: string;
  messageId?: string;
  agent?: string;
  modelId?: string;
  time?: { created?: number; completed?: number };
  reason?: string;
  requestId?: string;
  filePath?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ReasoningContentPayload {
  messageId?: string;
  content?: string;
  [key: string]: unknown;
}

interface ReadFilePromptPayload {
  filePath: string;
  content?: string;
  type?: string;
  reason?: string;
  requestId?: string;
  [key: string]: unknown;
}

interface SkillListPayload {
  skills: { name: string; description?: string }[];
}

interface StatusPayload {
  status: 'idle' | 'running' | 'error';
  message?: string;
}

/**
 * All messages the extension sends to the webview.
 * Discriminated by `type` field for type-safe handling.
 */
export type ExtensionToWebviewMessage =
  | { type: 'receiveMessage'; payload: ReceiveMessagePayload }
  | { type: 'receiveChunk'; payload: ReceiveChunkPayload }
  | { type: 'streamEnd'; payload: StreamEndPayload }
  | { type: 'reviewReady'; payload: { diff: string } }
  | { type: 'reviewResolved'; payload: { accepted: boolean } }
  | { type: 'status'; payload: StatusPayload }
  | { type: 'gitInfo'; payload: GitInfoPayload }
  | { type: 'projectInfo'; payload: ProjectInfo }
  | { type: 'sessionList'; payload: SessionListPayload[] }
  | { type: 'sessionLoaded'; payload: SessionLoadedPayload }
  | { type: 'sessionDeleted'; payload: SessionDeletedPayload }
  | { type: 'agentList'; payload: { agents: string[] } }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'providerList'; payload: ProviderListPayload }
  | { type: 'providerUpdated'; payload: ProviderUpdatedPayload }
  | { type: 'fileSearchResults'; payload: FileSearchResultsPayload }
  | { type: 'savedModel'; payload: string | SavedModelPayload }
  | { type: 'toolEvent'; payload: ToolEventPayload }
  | { type: 'revertResult'; payload: RevertResultPayload }
  | { type: 'messageMeta'; payload: MessageMetaPayload }
  | { type: 'reasoningContent'; payload: string | ReasoningContentPayload }
  | { type: 'readFilePrompt'; payload: ReadFilePromptPayload }
  | { type: 'skillList'; payload: SkillListPayload };

/**
 * Single file changed in a session diff.
 */
export interface SessionDiffFile {
  path: string;
  added: number;
  deleted: number;
  content: string;
}

/**
 * Session diff containing all files changed in a session.
 */
export interface SessionDiff {
  sessionID: string;
  files: SessionDiffFile[];
}

/**
 * Current project metadata from the opencode server.
 */
export interface ProjectInfo {
  name?: string;
  path?: string;
  project?: string;
  agent?: string;
  vcs?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Version control state for the current project.
 */
export interface VcsInfo {
  branch?: string;
  commit?: string;
  message?: string;
  dirty?: boolean;
}

/**
 * Path information for file operations.
 */
export interface PathInfo {
  path: string;
  project?: string;
}

/**
 * Runtime array of valid webview-to-extension message types.
 * Used for validation in vscode-api.ts and SidebarProvider.ts.
 */
export const WEBVIEW_TO_EXTENSION_TYPES = [
  'sendMessage', 'acceptReview', 'rejectReview', 'clearChat', 'abort',
  'getSessions', 'loadSession', 'deleteSession', 'switchAgent', 'listProviders',
  'setApiKey', 'removeApiKey', 'searchFiles', 'getSavedModel', 'saveModel',
  'revertMessage', 'unrevert', 'respondPermission', 'respondReadPermission',
  'openDiff', 'runCommand', 'loadSkills',
] as const;

/**
 * Runtime array of valid extension-to-webview message types.
 * Used for validation in vscode-api.ts and SidebarProvider.ts.
 */
export const EXTENSION_TO_WEBVIEW_TYPES = [
  'receiveMessage', 'receiveChunk', 'streamEnd', 'reviewReady', 'reviewResolved',
  'status', 'gitInfo', 'projectInfo', 'sessionList', 'sessionLoaded', 'sessionDeleted',
  'agentList', 'error', 'providerList', 'providerUpdated', 'fileSearchResults',
  'savedModel', 'toolEvent', 'revertResult', 'messageMeta', 'reasoningContent',
  'readFilePrompt', 'skillList',
] as const;