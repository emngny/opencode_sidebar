# Opencode VS Code Extension

## Build & Dev

- **Full build:** `npm run compile` (= `tsc -p tsconfig.extension.json && npm run build:webview`)
- **Extension only:** `tsc -p tsconfig.extension.json`
- **Webview only:** `node esbuild.config.js`
- **Watch:** `npm run watch:extension` (tsc) and `npm run watch:webview` (esbuild) in parallel
- **Package:** `npx vsce package`
- **No lint, no tests, no CI** — skipping these will not fail the build
- **Dependencies:** `marked` (markdown render), `opencode-ai` (server package), `react` 18, `esbuild` for bundling

## Architecture

Two independent compilation targets under `src/`:

| Target | Dir | Entry | Build |
|--------|-----|-------|-------|
| Extension (Node.js) | `src/extension/` | `extension.ts` | tsc |
| Webview (React/DOM) | `src/webview/` | `index.tsx` | esbuild → IIFE `out/webview.js` |

- Webview imports types from `src/extension/types.ts` (included via `tsconfig.webview.json` `include`)
- Webview <-> Extension communication via typed `postMessage`/`onMessage` in `types.ts`
- Extension runs in VS Code's Electron Node — Node builtins are available
- Single `package.json`, no monorepo

## Key Files

| File | Role |
|------|------|
| `src/extension/extension.ts` | Activation entrypoint; wires SidebarProvider, PreviewProvider, ReviewQueue, commands |
| `src/extension/providers/SidebarProvider.ts` | Webview view provider; message dispatch hub |
| `src/extension/services/OpencodeCli.ts` | Manages `opencode serve` subprocess (spawns with `--port 0`), HTTP API client, SSE streaming |
| `src/extension/services/ReviewQueue.ts` | Review queue with Accept/Reject; virtual doc via `opencode-preview://` |
| `src/extension/providers/PreviewProvider.ts` | Text content provider for `opencode-preview://` scheme |
| `src/extension/types.ts` | Shared types: ChatMessage, message types (WebviewTo/ExtensionTo), ProviderInfo, etc. |
| `src/webview/App.tsx` | Main React app; message handler hub |
| `src/webview/components/ChatContainer.tsx` | Message renderer: ChatBubble, EventCard, ContextGroup, CompactionDivider |

## Critical Gotchas

- **Model IDs use `providerId/modelId` format** (e.g., `opencode/glm-5.1`) to avoid duplicates
- **`sendPrompt` reads POST `/session/:id/message` as SSE stream** (`text/event-stream`), not JSON. Parses `data:` lines, stops on `session.status` → `idle`
- **Extension protects own install directory** — ReviewQueue blocks edits to files under the extension's path
- **`opencode serve` binary resolution** hardcoded to Windows paths in `resolveBinary()`
- **No authentication UI** — server generates password (`oc-vsc-{random}`), uses Basic Auth
- **Permission asked events** are sent to webview for user decision (Allow/Always/Deny), not auto-granted
- **Session is reused** across messages with the same `currentSessionId`; only `clearChat`/`abort` creates a new one
- **Event stream** sends `message.part.delta` for streaming text (field=`"text"`), `message.part.updated` for tool/compaction/reasoning status
- **Reasoning content** comes as `message.part.delta` with `partType === 'reasoning'` — accumulated in `ChatMessage.reasoning`
- **Context gathering tools** (read/glob/grep/list/webfetch) are grouped into a single `ContextGroup` component
- **Tool event types** in webview: `tool_call`, `tool_result`, `thinking`, `permission`, `compacting`, `file_edit`
- **Revert API**: `POST /session/:id/revert` with `{ messageID }` — undoes file changes via git snapshots
- **Markdown** is rendered via `marked` library in `Markdown.tsx` (code blocks get copy buttons)
- **Agent colors** defined in `agentColors.ts` — build=blue, plan=pink, ask=green, debug=yellow, docs=teal, code=purple, review=orange
- **UI language is English** — all user-facing strings are in English

## Commands & Activation

- Activates on `onView:opencode.sidebar` (sidebar open), `opencode.run`, `opencode.acceptChange`, `opencode.rejectChange`
- Accept/Reject buttons in diff editor toolbar via `when: "isInDiffEditor && opencode.hasActiveReview"`
- View container defined in both `activitybar` (left) and `secondarySidebar` (right) — appears in right panel automatically on supported VS Code versions
