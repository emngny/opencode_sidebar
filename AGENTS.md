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

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
