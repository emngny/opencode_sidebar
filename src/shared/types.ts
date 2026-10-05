/**
 * Display-ready chat message with optional streaming and metadata.
 * Used for both user messages and assistant responses including tool events.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event';
  content: string;
  timestamp: number;
  id?: string;
  requestId?: string;
  sessionId?: string;
  /**
   * The opencode server's own assistant message id, e.g. `msg_...`.
   *
   * One turn is several server messages — the agent speaks, runs a tool, then
   * speaks again — and each one is its own bubble. Keying the bubble by this
   * rather than by `requestId` is what keeps the transcript in arrival order:
   * a `requestId` spans the whole turn, so text streamed after a tool would be
   * folded into the bubble that was opened before it.
   */
  serverMessageId?: string;
  isStreaming?: boolean;
  eventType?:
    | 'tool_call'
    | 'tool_result'
    | 'file_read'
    | 'file_edit'
    | 'thinking'
    | 'discovery'
    | 'compacting'
    | 'permission'
    | 'question';
  eventStatus?: 'running' | 'completed' | 'failed';
  /** Number of identical consecutive tool events merged into this card. */
  eventCount?: number;
  /**
   * How many `file_edit` cards for this path were collapsed into one, set by
   * the webview's `groupFileEdits` at render time. `eventMeta.added` and
   * `eventMeta.deleted` hold the summed totals for the group.
   */
  fileEditCount?: number;
  eventMeta?: {
    path?: string;
    added?: number;
    deleted?: number;
    name?: string;
    args?: unknown;
    result?: unknown;
    error?: string;
    sessionId?: string;
    description?: string;
    subagentType?: string;
    permId?: string;
    permSessionId?: string;
    patterns?: string[];
    permType?: string;
    content?: string;
    /** Server request id (`que_...`) a `question` card answers. */
    questionId?: string;
    questions?: QuestionInfo[];
    /** Selected labels per question, in question order. */
    answers?: string[][];
  };
  agent?: string;
  modelId?: string;
  /** Model the client asked for. Differs from modelId when an agent config pins its own model. */
  requestedModelId?: string;
  duration?: number;
  interrupted?: boolean;
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Shared domain types — single source of truth for ApiClient / OpencodeCli /
// EventDispatcher / SidebarProvider / useMessageHandler
// ---------------------------------------------------------------------------

/** Type guard helper: plain record check */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // `fetch` reports every transport failure as the bare string "fetch failed"
    // and hides the reason in `cause`, which is where undici puts the useful
    // part (HeadersTimeoutError, ECONNRESET, and so on). Reporting only the
    // outer message is why a stalled prompt could only ever report "fetch
    // failed" with nothing to act on.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && !err.message.includes(cause.message)) {
      return `${err.message}: ${cause.message}`;
    }
    return err.message;
  }
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err) ?? 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

/** Raw message part as returned by GET /session/:id/message */
export interface SessionMessagePart {
  id?: string;
  type?: string;
  text?: string;
  content?: string;
  [key: string]: unknown;
}

export interface SessionMessageInfo {
  id?: string;
  role?: string;
  content?: string;
  time?: { created?: number; completed?: number };
  agent?: string;
  model?: { providerID?: string; modelID?: string };
  [key: string]: unknown;
}

export interface RawSessionMessage {
  info?: SessionMessageInfo;
  parts?: SessionMessagePart[];
  [key: string]: unknown;
}

/** Agent as returned by GET /agent — string or object with id/name/slug/key */
export type AgentRaw =
  | string
  | {
      id?: string;
      name?: string;
      slug?: string;
      key?: string;
      mode?: string;
      [key: string]: unknown;
    };

export function normalizeAgentId(raw: AgentRaw): string {
  if (typeof raw === 'string') return raw;
  if (isRecord(raw)) {
    const id = raw['id'] ?? raw['name'] ?? raw['slug'] ?? raw['key'];
    return typeof id === 'string' ? id : '';
  }
  return '';
}

/** Agent identity plus the mode opencode reports for it. */
export interface AgentSummary {
  id: string;
  /** `primary`/`all` can own a session; `subagent` is reachable only through the task tool. */
  mode?: string;
  /** Model the agent pins as `provider/model`. Without a pin the request's model is used. */
  model?: string;
}

/**
 * Agents opencode drives on its own behalf. GET /agent reports them as primary,
 * but they are not modes a user should start a chat with.
 */
const INTERNAL_AGENT_IDS = new Set(['compaction', 'summary', 'title']);

export function mapAgentSummaries(rawList: AgentRaw[]): AgentSummary[] {
  return rawList
    .map((raw) => {
      const record = isRecord(raw) ? raw : undefined;
      const model = record && isRecord(record['model']) ? (record['model'] as Record<string, unknown>) : undefined;
      const providerID = model && typeof model['providerID'] === 'string' ? (model['providerID'] as string) : '';
      const modelID = model && typeof model['modelID'] === 'string' ? (model['modelID'] as string) : '';
      return {
        id: normalizeAgentId(raw),
        mode: record && typeof record['mode'] === 'string' ? (record['mode'] as string) : undefined,
        model: providerID && modelID ? `${providerID}/${modelID}` : undefined,
      };
    })
    .filter((agent) => Boolean(agent.id));
}

/**
 * Keeps only agents that can own a session. Running a subagent as the chat mode
 * makes opencode use the subagent definition, which can pin its own model and
 * silently ignore the model chosen in the picker.
 */
export function filterChatModeAgents(agents: AgentSummary[]): AgentSummary[] {
  return agents.filter(
    (agent) => !INTERNAL_AGENT_IDS.has(agent.id) && (!agent.mode || agent.mode === 'primary' || agent.mode === 'all'),
  );
}

/**
 * A slash command opencode serves, as reported by `GET /command`.
 *
 * The server is the only authority on this list: it aggregates commands from
 * its own config, the global skill roots, and every plugin package, so a local
 * guess cannot know what exists. Names like `brainstorming` or
 * `brainstorm-plan` live in `~/.agents/skills` and are invisible to a
 * workspace-only scan.
 */
export interface CommandSummary {
  name: string;
  description?: string;
  /** `command` for opencode's own commands, `skill` for a skill, `mcp` for an MCP tool. */
  source?: string;
  /** Agent the command pins; running it overrides the chat mode. */
  agent?: string;
  /** Runs as a subtask instead of taking over the session. */
  subtask?: boolean;
}

/** Raw shape of a `GET /command` entry. Only `name` is guaranteed. */
export type CommandRaw = string | Record<string, unknown>;

/**
 * Narrows a raw `/command` entry to the fields the webview renders.
 *
 * `template` is deliberately dropped: the 528 commands this machine reports
 * carry 5.2 MB of prompt templates between them, and the server expands a
 * command itself when the prompt starts with `/name`, so nothing needs them.
 */
export function mapCommandSummaries(rawList: CommandRaw[]): CommandSummary[] {
  const seen = new Set<string>();
  const result: CommandSummary[] = [];
  for (const raw of rawList) {
    if (typeof raw === 'string') {
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      result.push({ name: raw });
      continue;
    }
    if (!isRecord(raw)) continue;
    const name = raw['name'];
    if (typeof name !== 'string' || !name || seen.has(name)) continue;
    seen.add(name);
    const description = raw['description'];
    const source = raw['source'];
    const agent = raw['agent'];
    result.push({
      name,
      description: typeof description === 'string' && description ? description : undefined,
      source: typeof source === 'string' ? source : undefined,
      agent: typeof agent === 'string' && agent ? agent : undefined,
      subtask: raw['subtask'] === true,
    });
  }
  return result;
}

export interface ProviderAuthPrompt {
  type?: string;
  label?: string;
  [key: string]: unknown;
}

export interface ProviderAuthEntry {
  type: string;
  label: string;
  prompts?: ProviderAuthPrompt[];
  [key: string]: unknown;
}

export type ProviderAuthMap = Record<string, ProviderAuthEntry[]>;

export interface SendPromptPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface SendPromptBody {
  parts: SendPromptPart[];
  model?: { providerID: string; modelID: string };
  agent?: string;
}

export interface RawDiff {
  path?: string;
  file?: string;
  content?: string;
  patch?: string;
  added?: number;
  deleted?: number;
  [key: string]: unknown;
}

export interface SessionListItem {
  id: string;
  name?: string;
  title?: string;
  updated?: string;
  time?: { created?: number; completed?: number };
  messageCount?: number;
  [key: string]: unknown;
}

/** Discriminated tool part as seen in SSE message.part.updated */
export interface ToolCallPart {
  id?: string;
  type: 'tool_call';
  name?: string;
  args?: unknown;
  [key: string]: unknown;
}

export interface ToolStatePart {
  id?: string;
  type: 'tool';
  tool?: string;
  state?: {
    status?: string;
    result?: unknown;
    error?: string;
    reason?: string;
    input?: { args?: unknown; description?: string; subagent_type?: string; [key: string]: unknown };
    metadata?: { sessionId?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  result?: unknown;
  args?: unknown;
  [key: string]: unknown;
}

export type ToolPart = ToolCallPart | ToolStatePart | { id?: string; type: string; [key: string]: unknown };

/** Convert RawSessionMessage[] to ChatMessage[] — shared mapper */
export function mapRawMessagesToChatMessages(raw: RawSessionMessage[], genId: () => string): ChatMessage[] {
  return raw.map((m) => {
    const content =
      m.parts
        // Tool parts are skipped rather than joined as empty strings, which
        // would leave a trailing newline on every message that also ran a tool.
        ?.filter((p) => p?.type !== 'tool')
        .map((p) => {
          if (typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
          return '';
        })
        .join('\n') ||
      m.info?.content ||
      '';
    return {
      role: m.info?.role === 'user' ? 'user' : 'assistant',
      content,
      timestamp: m.info?.time?.created || Date.now(),
      id: m.info?.id || genId(),
    };
  });
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
  requestId?: string;
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

/** One question inside a `question.asked` request. */
export interface QuestionInfo {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiple?: boolean;
  /** Server default is true: a free-form answer is offered alongside the options. */
  custom?: boolean;
}

/** A pending `question.asked` request, as returned by `GET /question`. */
export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
}

/**
 * Answer payload for the opencode `question` tool.
 *
 * `answers` is one array of selected labels per question, in question order;
 * an empty array means that question was left unanswered. Omitting `answers`
 * entirely rejects the request instead of replying to it.
 */
interface RespondQuestionPayload {
  questionId: string;
  answers?: string[][];
}

interface OpenDiffPayload {
  filePath: string;
}

/**
 * Absolute http(s)/mailto URL to hand to the OS via `vscode.env.openExternal`.
 */
interface OpenExternalPayload {
  url: string;
}

interface RunCommandPayload {
  command: string;
  args?: string;
  isSkill?: boolean;
  /**
   * The command came from the server's own list rather than a workspace skill.
   * The server expands these itself when the prompt starts with `/name`, so the
   * extension forwards the name instead of substituting a local template.
   */
  isCommand?: boolean;
  /** Agent the command pins, so it runs under its own mode rather than the active one. */
  agent?: string;
  /**
   * Model for the turn, resolved by the webview exactly as a normal send does.
   *
   * Required, not optional in practice: a command reaches `processPrompt`
   * without going through the send path, so a missing model let the server fall
   * back to its default agent — which pins `opencode-go/normal-combo`, a model
   * that is not in the catalog, and the turn died with `ProviderModelNotFoundError`.
   */
  model?: string;
  /** Chat mode to run under; defaults to the active one on the extension side. */
  mode?: string;
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
  | { type: 'respondQuestion'; payload: RespondQuestionPayload }
  | { type: 'openDiff'; payload: OpenDiffPayload }
  | { type: 'openExternal'; payload: OpenExternalPayload }
  | { type: 'runCommand'; payload: RunCommandPayload }
  | { type: 'loadSkills'; payload?: undefined }
  | { type: 'webviewReady'; payload?: undefined };

interface ReceiveMessagePayload {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event';
  content: string;
  requestId?: string;
  sessionId?: string;
  timestamp?: number;
  id?: string;
  project?: string;
  reason?: string;
}

interface ReceiveChunkPayload {
  content: string;
  requestId?: string;
  sessionId?: string;
  /** Owning server message, so the webview can open a bubble per agent step. */
  messageId?: string;
}

interface StreamEndPayload {
  content: string;
  requestId?: string;
  sessionId?: string;
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
  /**
   * Whether the server was still streaming this session when the transcript was
   * fetched. A rehydrated webview starts with `busy === false`, so without this
   * a live turn renders as finished.
   */
  busy?: boolean;
  /**
   * Request id of the in-flight turn, if any. The webview needs it to attach
   * incoming deltas to the rehydrated assistant message instead of opening a
   * duplicate bubble.
   */
  activeRequestId?: string | null;
}

interface SessionDeletedPayload {
  sessionId: string;
}

interface ErrorPayload {
  message: string;
  error?: string;
  requestId?: string;
  sessionId?: string;
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
  requestId?: string;
  files: { name: string; path: string; description?: string }[];
}

/**
 * Saved model configuration payload.
 */
export interface SavedModelPayload {
  model?: string;
}

interface ToolEventPayload {
  id?: string;
  requestId?: string;
  sessionId?: string;
  type: string;
  name: string;
  status: string;
  content?: string;
  meta?: Record<string, unknown>;
}

interface RevertResultPayload {
  sessionId: string;
  result: unknown;
  messages: unknown[];
  reverted: boolean;
}

interface MessageMetaPayload {
  id?: string;
  requestId?: string;
  sessionId?: string;
  messageId?: string;
  agent?: string;
  modelId?: string;
  /** Model the client requested for this turn, echoed back for override detection. */
  requestedModel?: string;
  time?: { created?: number; completed?: number };
  reason?: string;
  filePath?: string;
  meta?: Record<string, unknown>;
}

interface ReasoningContentPayload {
  requestId?: string;
  sessionId?: string;
  messageId?: string;
  content?: string;
}

interface ReadFilePromptPayload {
  filePath: string;
  content?: string;
  type?: string;
  reason?: string;
  requestId?: string;
}

interface SkillListPayload {
  skills: { name: string; description?: string }[];
}

/**
 * Slash commands the running server offers. The webview renders this instead
 * of a hard-coded list so every command the server knows about — including the
 * skills installed outside the workspace — is reachable from the picker.
 */
interface CommandListPayload {
  commands: CommandSummary[];
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
  | { type: 'projectInfo'; payload: ProjectInfoPayload }
  | { type: 'sessionList'; payload: SessionListPayload[] }
  | { type: 'sessionLoaded'; payload: SessionLoadedPayload }
  | { type: 'sessionDeleted'; payload: SessionDeletedPayload }
  | { type: 'agentList'; payload: { agents: string[]; agentModels?: Record<string, string> } }
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
  | { type: 'skillList'; payload: SkillListPayload }
  | { type: 'commandList'; payload: CommandListPayload };

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
}

/**
 * projectInfo message payload: project/path/vcs info, each nullable.
 */
export interface ProjectInfoPayload {
  project: ProjectInfo | null;
  path: PathInfo | null;
  vcs: VcsInfo | null;
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
  'sendMessage',
  'acceptReview',
  'rejectReview',
  'clearChat',
  'abort',
  'getSessions',
  'loadSession',
  'deleteSession',
  'switchAgent',
  'listProviders',
  'setApiKey',
  'removeApiKey',
  'searchFiles',
  'getSavedModel',
  'saveModel',
  'revertMessage',
  'unrevert',
  'respondPermission',
  'respondReadPermission',
  'respondQuestion',
  'openDiff',
  'openExternal',
  'runCommand',
  'loadSkills',
  'webviewReady',
] as const;

/**
 * Runtime array of valid extension-to-webview message types.
 * Used for validation in vscode-api.ts and SidebarProvider.ts.
 */
export const EXTENSION_TO_WEBVIEW_TYPES = [
  'receiveMessage',
  'receiveChunk',
  'streamEnd',
  'reviewReady',
  'reviewResolved',
  'status',
  'gitInfo',
  'projectInfo',
  'sessionList',
  'sessionLoaded',
  'sessionDeleted',
  'agentList',
  'error',
  'providerList',
  'providerUpdated',
  'fileSearchResults',
  'savedModel',
  'toolEvent',
  'revertResult',
  'messageMeta',
  'reasoningContent',
  'readFilePrompt',
  'skillList',
  'commandList',
] as const;
