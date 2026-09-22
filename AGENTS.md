# Opencode VS Code Extension

## Build & Dev

- **Full build:** `npm run compile` (= `tsc -p tsconfig.extension.json && npm run build:webview`)
- **Extension only:** `tsc -p tsconfig.extension.json`
- **Webview only:** `node esbuild.config.js`
- **Watch:** `npm run watch:extension` (tsc) and `npm run watch:webview` (esbuild) in parallel
- **Package:** `npx vsce package`
- **Dependencies:** `marked` + `dompurify` (markdown), `opencode-ai` (server), `react` 18, `esbuild`

## Architecture

Two independent compilation targets under `src/`:

| Target | Dir | Entry | Build |
|--------|-----|-------|-------|
| Extension (Node.js) | `src/extension/` | `extension.ts` | tsc → `out/` |
| Webview (React/DOM) | `src/webview/` | `index.tsx` | esbuild → `out/webview.js` |

- Webview imports types from `src/extension/types.ts` (included via `tsconfig.webview.json`)
- Webview ↔ Extension via typed `postMessage`/`onMessage` in `types.ts` + `vscode-api.ts`
- Extension runs in VS Code's Electron Node — Node builtins available
- Single `package.json`, no monorepo
- The `commands/` directory is empty — no VS Code commands are registered beyond the webview provider. The `opencode.run` command declared in `package.json` is never wired up.

## Key Files

| File | Role |
|------|------|
| `src/extension/extension.ts` | Activation entrypoint; registers SidebarProvider only |
| `src/extension/providers/SidebarProvider.ts` | Webview view provider; message dispatch, session management, permission prompts, skills loading |
| `src/extension/services/OpencodeCli.ts` | Spawns `opencode serve --port 0`, HTTP API client, SSE streaming, diff polling, permission granting |
| `src/extension/types.ts` | Shared types: ChatMessage, message types (WebviewTo/ExtensionTo), ProviderInfo, SessionDiff, etc. |
| `src/extension/services/readPatterns.ts` | Deny patterns blocking reads of `.env`, secrets, `node_modules`, build artifacts |
| `src/webview/App.tsx` | Main React app; message handler hub, model/mode/session state, revert, abort |
| `src/webview/components/ChatContainer.tsx` | Message renderer: ChatBubble, EventCard, ContextGroup, CompactionDivider, DiffPreview |

## Critical Gotchas

- **Model IDs use `providerId/modelId` format** (e.g., `opencode/glm-5.1`) to avoid duplicates across providers
- **`sendPrompt` reads POST `/session/:id/message` as SSE stream** (`text/event-stream`), not JSON. Also listens to `/event` SSE endpoint. Parses `data:` lines, stops on `session.status` → `idle`
- **`opencode serve` binary resolution** hardcoded to Windows paths in `resolveBinary()` — tries 3 candidate paths before falling back to `PATH`
- **API keys stored in VS Code SecretStorage**, restored on startup via `_restoreApiKeys()`
- **No auth UI** — server generates `oc-vsc-{random}` password, uses Basic Auth
- **Permission events** sent to webview for user decision (Allow Once/Always/Deny), not auto-granted. Read prompts also appear for files matching `readPatterns.ts` deny rules
- **Session reused** with same `currentSessionId`; `clearChat`/`abort` resets it to null, forcing a new session on next message
- **Event stream**: `message.part.delta` for streaming text (field=`"text"`), `message.part.updated` for tool/compaction/reasoning, `message.updated`/`session.diff` for file diffs
- **Reasoning** arrives as `message.part.delta` with `partType === 'reasoning'`, accumulated in `ChatMessage.reasoning`, toggleable in UI
- **Context tools** (read/glob/grep/list/webfetch/websearch/search) grouped into `ContextGroup` component; non-context tools render as `EventCard`
- **Tool event types** in webview: `tool_call`, `tool_result`, `thinking`, `discovery`, `permission`, `compacting`, `file_edit`, `file_read`
- **Revert API**: `POST /session/:id/revert` with `{ messageID }` undoes file changes via git snapshots; `POST /session/:id/unrevert` restores
- **Markdown** uses `marked` + `DOMPurify` sanitization; code blocks get copy buttons
- **Agent colors** (`agentColors.ts`): build=blue, plan=pink, ask=green, debug=yellow, docs=teal, code=purple, review=orange
- **AGENTS.md and SKILL.md are gitignored** — won't appear in git status
- **CSP** in the HTML template restricts `connect-src` to the specific dynamic server port (read from `opencode.url`)
- **Skills** loaded from `.agents/skills/` — each subdirectory with a `SKILL.md` becomes a `/skillname` slash command

## Slash Commands

Built-in (handled in `App.tsx` + `slashCommands.ts`):
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

| Command | Action |
|---|---|
| `ctx stats` | Call stats tool and display output verbatim |
| `ctx doctor` | Call doctor tool, run returned command, display checklist |
| `ctx upgrade` | Call upgrade tool, run returned command, display checklist |
| `ctx purge` | Warn, then call purge with `confirm: true` |

After `/clear` or `/compact`, context-mode knowledge base and session stats persist. Use `ctx purge` to start fresh.
<!-- CONTEXT_MODE_END -->
