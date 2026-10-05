# Opencode VS Code Extension

## Build & Dev

- **Full build:** `npm run compile` (= `tsc -p tsconfig.extension.json && npm run build:webview`)
- **Extension only:** `tsc -p tsconfig.extension.json`
- **Webview only:** `node esbuild.config.js`
- **Watch:** `npm run watch:extension` (tsc) and `npm run watch:webview` (esbuild) in parallel
- **Package:** `npx vsce package`
- **Test:** `npm test` locally (no coverage, fast); CI's Test step runs `npm run test:coverage`, which enforces the thresholds in `vitest.config.ts` (60/60/60/60). Branch sits near the line (~60.4), so an uncovered branch fails CI — run `npm run test:coverage` before pushing when touching untested code
- **Dependencies:** `marked` + `dompurify` (markdown), `opencode-ai` (server), `react` 18, `esbuild`

## Architecture

Two independent compilation targets under `src/`:

| Target              | Dir              | Entry          | Build                      |
| ------------------- | ---------------- | -------------- | -------------------------- |
| Extension (Node.js) | `src/extension/` | `extension.ts` | tsc → `out/`               |
| Webview (React/DOM) | `src/webview/`   | `index.tsx`    | esbuild → `out/webview.js` |

- Webview imports types from `src/extension/types.ts` (included via `tsconfig.webview.json`)
- Webview ↔ Extension via typed `postMessage`/`onMessage` in `types.ts` + `vscode-api.ts`
- Extension runs in VS Code's Electron Node — Node builtins available
- Single `package.json`, no monorepo
- The `commands/` directory is empty — no VS Code commands are registered beyond the webview provider.

## Key Files

| File                                         | Role                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/extension/extension.ts`                 | Activation entrypoint; registers SidebarProvider only                                                |
| `src/extension/providers/SidebarProvider.ts` | Webview view provider; message dispatch, session management, permission prompts, skills loading      |
| `src/extension/services/OpencodeCli.ts`      | Spawns `opencode serve --port 0`, HTTP API client, SSE streaming, diff polling, permission granting  |
| `src/extension/types.ts`                     | Shared types: ChatMessage, message types (WebviewTo/ExtensionTo), ProviderInfo, SessionDiff, etc.    |
| `src/extension/services/readPatterns.ts`     | Deny patterns blocking reads of `.env`, secrets, `node_modules`, build artifacts                     |
| `src/webview/App.tsx`                        | Main React app; message handler hub, model/mode/session state, revert, abort, new chat               |
| `src/webview/components/ChatContainer.tsx`   | Message renderer: ChatBubble, EventCard, ContextGroup, CompactionDivider, DiffPreview                |
| `src/webview/hooks/useChatState.ts`          | Conversation state: messages, contextEvents, busy, streaming debounce buffers, `resetConversation()` |     | `src/webview/hooks/useMessageHandler.ts` | Extension → webview reducer: streaming deltas, `sessionLoaded` rehydration, permission prompts |
| `src/webview/hooks/useModelManager.ts`       | Model/agent/skills state; persists mode, hidden models, provider panel via `setState`                |

## Critical Gotchas

- **`retainContextWhenHidden` is deliberately NOT set** on the webview. VS Code deallocates the webview document whenever the view is hidden and rebuilds it on the next show, so the React app remounts empty. The extension instead rehydrates: `webviewReady` posts `sessionLoaded` (with `busy` and `activeRequestId`) for the live session, and `acquireVsCodeApi().setState()` keeps the agent mode, hidden models, and provider panel. Setting the flag would not help — VS Code documents that you _cannot_ post messages to a hidden webview even with it enabled — and it carries a high memory overhead
- **A permission asked while the view is hidden is a deadlock risk**: the prompt only exists as a live event, and history cannot rebuild it, so the server would wait forever. `EventDispatcher` holds it, `OpencodeCli` exposes it per in-flight request, `webviewReady` replays it, and `SidebarProvider.postMessage` raises a VS Code notification while the view is hidden
- **A `question` from the agent blocks its turn the same way.** The `question` tool waits for `POST /question/:id/reply` or `/reject`, and its request only ever arrives as a live `question.asked` event, so an unhandled one leaves the transcript on `question running…` forever. `questionEventFromRequest` in `EventDispatcher.ts` is the single mapping from request to card — the live path and the `GET /question` replay in `webviewReady` both go through it — and `QuestionCard` in `EventCard.tsx` collects the answers, one array per question in order. `SidebarProvider` raises the same hidden-view notification a blocked permission does
- **Model IDs use `providerId/modelId` format** (e.g., `opencode/glm-5.1`) to avoid duplicates across providers
- **`sendPrompt` reads POST `/session/:id/message` as SSE stream** (`text/event-stream`), not JSON. Also listens to `/event` SSE endpoint. Parses `data:` lines, stops on `session.status` → `idle`
- **`opencode serve` binary resolution** hardcoded to Windows paths in `resolveBinary()` — tries 3 candidate paths before falling back to `PATH`
- **API keys stored in VS Code SecretStorage**, restored on startup via `_restoreApiKeys()`
- **No auth UI** — server generates `oc-vsc-{random}` password, uses Basic Auth
- **Permission events** sent to webview for user decision (Allow Once/Always/Deny), not auto-granted. Read prompts also appear for files matching `readPatterns.ts` deny rules
- **Session reused** with same `currentSessionId`; the New Chat button / `/new` posts `clearChat`, which resets it to null and forces a new session on next message. `clearChat` and `abort` split in `SidebarMessageHandler`: both stop the server stream, but only `clearChat` drops `currentSessionId` — `abort` keeps the identity so the next send continues the same session under the transcript still on screen. The webview side also distinguishes them — `abort` keeps the transcript, `clearChat` also runs `resetConversation()`
- **Event stream**: `message.part.delta` for streaming text (field=`"text"`), `message.part.updated` for tool/compaction/reasoning, `message.updated`/`session.diff` for file diffs
- **Green in a tool card means a file changed, nothing else.** `EventCard` keys its icon and colour off `eventType` for that reason: only `file_edit` gets ✅, and it is safe because the diff stream drops zero-change entries (`ChatCoordinator.ts:63`). A finished `bash`/`lsp_diagnostics` result changes no file and stays neutral. Keying off `eventStatus` instead made the transcript read as a list of edited files
- **Tool part → card mapping lives in exactly one place**, `toolEventsFromPart` in `EventDispatcher.ts`. The live path calls it from `handleToolStateEvent`; `SessionService` calls it to rebuild cards for a restored session. A second implementation would let the two paths drift
- **`mapRawMessagesToChatMessages` flattens text only** and drops tool parts; `SessionService.withToolEvents` re-inserts the cards afterwards, and `withFileEdits` appends one `file_edit` per file from `GET /session/:id/diff`. That diff is cumulative, so it carries no turn and the cards go at the end of the transcript
- **The POST is not the completion signal; `session.status` idle is.** Current opencode answers `POST /session/:id/message` with the finished message as JSON, so it sends no response header until the turn ends and undici abandons it after `headersTimeout` (300s, verified). Measured: `idle` fires exactly once per turn (`busy` repeats, `idle` does not), so it is a reliable end-of-turn marker. A POST that dies _after_ events arrived is our transport giving up, not a server failure — report nothing and let the stream finish the turn; report only when nothing ever arrived. The POST body is a backstop for text `/event` did not carry, hence the 2s grace after idle
- **`getErrorMessage` includes `cause`.** `fetch` collapses every transport failure to `fetch failed`; without this the log says nothing actionable
- **Never seed the agent list or the mode with a guess.** The mode reconciler in `App.tsx` treats `agents` as the truth about which modes the server offers, so a hard-coded default (`['build','plan',…]`, and `mode = 'build'`) made it "correct" a valid mode into one the server had never heard of; the real `agentList` then corrected it back, producing a `Mode "…" is not available … Switched to "…"` pair on every open. `agents` starts empty and a ref records that the server has answered. On a machine where opencode plugins own the agents, `build`/`plan`/`review` are **subagents**, not chat modes, so the guess was wrong by default
- **An empty `agentList` is an answer, not a missing one.** `filterChatModeAgents` can return nothing, and then the reconciler must stop trusting the previous list, so `agentList` sets `agents` to `[]` rather than skipping the update
- **A `requestId` spans a whole turn; a `serverMessageId` spans one agent step.** A turn is a sequence of opencode messages — speak, tool, speak again — so `ChatMessage.serverMessageId` keys the bubble and `EventDispatcher` threads `messageID` through `onContent`/`onReasoning`. Keying by `requestId` instead spans the whole turn: every step's text folds into the bubble opened before the tool ran, and the narration renders _above_ the tool cards. `ChatCoordinator` therefore accumulates `fullContent` per message id, and the webview appends a new bubble at the end of the transcript when it sees an id it has not seen. `ChatCoordinator` no longer posts an up-front empty assistant placeholder — it would sit there permanently empty. `streamEnd` closes every bubble of the request, not the first
- **Restored turns are trimmed** to their last 3 routine tool cards (`RESTORED_TOOL_CARDS_PER_TURN` in `SessionService.ts`) with an `N earlier operations` card in their place. `failed`, `file_edit`, `file_read`, `permission`, and `thinking` cards are never dropped
- **`groupFileEdits` runs at render time** in `ChatContainer`, not in state. It folds same-path `file_edit` cards within one turn and sums `added`/`deleted`; windowing still counts the raw stream so paging stays correct. A user message is a turn boundary, an assistant message is not — assistant messages interleave with tool events, and treating them as a boundary would leave the repeated cards unmerged
- **Reasoning** arrives as `message.part.delta` with `partType === 'reasoning'`, accumulated in `ChatMessage.reasoning`, toggleable in UI
- **Context tools** (read/glob/grep/list/webfetch/websearch/search) grouped into `ContextGroup` component; non-context tools render as `EventCard`
- **Tool event types** in webview: `tool_call`, `tool_result`, `thinking`, `discovery`, `permission`, `question`, `compacting`, `file_edit`, `file_read`
- **Revert API**: `POST /session/:id/revert` with `{ messageID }` undoes file changes via git snapshots; `POST /session/:id/unrevert` restores
- **Markdown** uses `marked` + `DOMPurify` sanitization; code blocks get copy buttons
- **Agent colors** (`agentColors.ts`): build=blue, plan=pink, ask=green, debug=yellow, docs=teal, code=purple, review=orange
- **AGENTS.md and SKILL.md are gitignored** — won't appear in git status
- **CSP** in the HTML template restricts `connect-src` to the specific dynamic server port (read from `opencode.url`)
- **Skills** loaded from `.agents/skills/` — each subdirectory with a `SKILL.md` becomes a `/skillname` slash command

## Slash Commands

Built-in (handled in `App.tsx` + `slashCommands.ts`):

- `/new` — Starts a fresh session. Agent-less command (no `agent` field), so `handleSlashCommand` handles it as a local action instead of routing it to the mode picker
- `/init` — Creates a template `AGENTS.md` in workspace root
- `/review` — Without text: runs `git diff --cached`, sends output for AI review. With text: switches to review mode and sends the remaining text as a prompt
- `/plan`, `/build`, `/ask`, `/debug`, `/docs`, `/code` — Switch agent mode; any remaining text after the command is sent as a prompt in that mode

## Activation

- Activates on `onView:opencode.sidebar` (sidebar opens) and `onCommand:opencode.run`
- View container in both `activitybar` (left) and `secondarySidebar` (right) — appears on the right on supported VS Code versions
- The extension only registers a `WebviewViewProvider` — no other commands, tree views, or toolbar items are wired despite the declared activation events

## Communication Style

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

<!-- caveman-begin -->

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:

- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
<!-- caveman-end -->

<!-- CODEGRAPH_START -->

# CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

<!-- CONTEXT_MODE_START -->

# context-mode — MANDATORY routing rules

`context-mode` tools are available. Rules protect context window from flooding.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: write code via `context-mode_ctx_execute(language, code)`, and `console.log()` only the answer. Do not read raw data into context. Use JavaScript with Node.js built-ins (`fs`, `path`, `child_process`) and handle `null`/`undefined`.

## BLOCKED — do not attempt

### curl / wget

Shell `curl`/`wget` is blocked. Use `context-mode_ctx_fetch_and_index(url, source)` or `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)" )`.

### Inline HTTP

`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, and `http.request(` are blocked. Use `context-mode_ctx_execute(language, code)`; only stdout enters context.

### Direct web fetching

Use `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)`.

## REDIRECTED — use sandbox

- Shell with more than 20 lines output: use `context-mode_ctx_batch_execute` or `context-mode_ctx_execute`. Shell is reserved for `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, and `pip install`.
- File reading for analysis: use `context-mode_ctx_execute_file(path, language, code)`. Reading to edit remains correct.
- Large grep/search: use `context-mode_ctx_execute(language: "javascript", code: "...")` for filtering/counting.

## Tool selection

1. `context-mode_ctx_batch_execute(commands, queries)` for gathering multiple command outputs.
2. `context-mode_ctx_search(queries: ["q1", "q2"])` for indexed content.
3. `context-mode_ctx_execute` / `context-mode_ctx_execute_file` for sandbox processing.
4. `context-mode_ctx_fetch_and_index` then `context-mode_ctx_search` for web content.
5. `context-mode_ctx_index(content, source)` for reusable documents.

For multi-URL/API I/O, set `concurrency` to 4–8. Keep `concurrency: 1` for CPU-bound commands and shared-state operations.

## Output and continuity

Write artifacts to files, not inline. Return file path plus one-line description. Session history is searchable; on resume, search context-mode memory before asking what work was in progress.

## ctx commands

| Command       | Action                                                     |
| ------------- | ---------------------------------------------------------- |
| `ctx stats`   | Call stats tool and display output verbatim                |
| `ctx doctor`  | Call doctor tool, run returned command, display checklist  |
| `ctx upgrade` | Call upgrade tool, run returned command, display checklist |
| `ctx purge`   | Warn, then call purge with `confirm: true`                 |

After `/clear` or `/compact`, context-mode knowledge base and session stats persist. Use `ctx purge` to start fresh.
<!-- CONTEXT_MODE_END -->
