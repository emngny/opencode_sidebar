# Opencode VS Code Extension

## Build & Dev

- **Full build:** `npm run compile` (= `tsc -p tsconfig.extension.json && npm run build:webview`)
- **Extension only:** `tsc -p tsconfig.extension.json`
- **Webview only:** `node esbuild.config.js`
- **Watch:** `npm run watch:extension` (tsc) and `npm run watch:webview` (esbuild) in parallel
- **Package:** `npx vsce package`
- **No lint, no tests, no CI** — skipping these will not fail the build

## Architecture

Two independent compilation targets under `src/`:

| Target | Dir | Entry | Build |
|--------|-----|-------|-------|
| Extension (Node.js) | `src/extension/` | `extension.ts` | tsc |
| Webview (React/DOM) | `src/webview/` | `index.tsx` | esbuild → IIFE `out/webview.js` |

- Webview imports types from `src/extension/types.ts` (included in `tsconfig.webview.json` via `include`)
- Extension runtime is VS Code's Electron Node — Node.js builtins are available
- Webview communicates with extension via `postMessage`/`onMessage` using typed messages in `types.ts`
- No npm workspace/monorepo — single `package.json`

## Key Files

- **`src/extension/extension.ts`** — activation entrypoint; wires up SidebarProvider, PreviewProvider, ReviewQueue, commands
- **`src/extension/providers/SidebarProvider.ts`** — webview view provider; message dispatch hub
- **`src/extension/services/OpencodeCli.ts`** — manages `opencode serve` subprocess (spawns with `--port 0`), HTTP API client, SSE streaming
- **`src/extension/services/ReviewQueue.ts`** — review queue with Accept/Reject; shows diff via `opencode-preview://` virtual documents
- **`src/extension/providers/PreviewProvider.ts`** — text content provider for `opencode-preview://` scheme
- **`src/webview/App.tsx`** — main React app; handles all webview message types

## Critical Gotchas

- **Model IDs use `providerId/modelId` format** (e.g., `opencode/glm-5.1`) to avoid duplicates — the `model` state in App.tsx follows this convention
- **`sendPrompt` reads POST `/session/:id/message` as SSE stream** (content-type `text/event-stream`), not JSON. Parses `data:` lines, stops on `session.status` → `idle`
- **Extension protects own files** — ReviewQueue blocks edits to files under the extension's install directory
- **No README.md** exists
- **UI language is English** — all user-facing strings are in English
- **No authentication UI** — server auto-generates password (`oc-vsc-{random}`) and sends via Basic Auth header
- **`opencode serve` binary resolution** hardcoded to Windows paths in `resolveBinary()`

## Commands & Activation

- Extension activates on `onView:opencode.sidebar` (sidebar open), `opencode.run`, `opencode.acceptChange`, `opencode.rejectChange`
- Accept/Reject buttons appear in diff editor toolbar via `when: "isInDiffEditor && opencode.hasActiveReview"`
- **View container defined in both `activitybar` and `secondarySidebar`** — appears in Secondary Side Bar (right) automatically on supported VS Code versions
