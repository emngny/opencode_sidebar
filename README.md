# Opencode Sidebar Chat

![Logo](resources/logo.png)

**Opencode Sidebar Chat** is an AI coding assistant for Visual Studio Code. It connects to the Opencode CLI and provides a chat interface in the VS Code sidebar with multi-provider support.

> This is an unofficial community extension and is not affiliated with or endorsed by Opencode.ai.

## Features

- **Multi-Provider Chat**: Switch between AI providers and models directly from the sidebar.
- **File Change Cards**: AI-edited files appear as clickable cards in chat — click to open the file in VS Code.
- **Permission Controls**: Granular Allow/Always/Deny prompts for file access.
- **Event Stream**: See tool calls, reasoning, and context gathering in real-time.
- **Session Management**: Browse, load, and delete past chat sessions.
- **Diff Visualization**: Bar charts show add/delete stats for each changed file.

## Prerequisites

- **Node.js** 18+ (for development and `opencode-ai` npm package)
- **VS Code** 1.82+
- **opencode CLI** installed globally or available on PATH:
  ```sh
  npm install -g opencode-ai
  ```

## Installation

1. Install the extension from the VS Code Marketplace.
2. Click the **Opencode** icon in the sidebar (right side by default).
3. Start chatting — the extension automatically starts `opencode serve` in the background.

## Provider Configuration

1. Open the extension sidebar and click the model dropdown (top of chat).
2. Select **Configure Providers** to see supported providers.
3. Enter your API key for each provider you want to use.
4. Keys are stored securely in VS Code's SecretStorage.

Supported providers include OpenAI, Anthropic, Google, Groq, and any provider supported by the opencode server.

## Slash Commands

Type `/` in the chat input to use slash commands:

| Command | Description |
|---------|-------------|
| `/init` | Creates a template `AGENTS.md` in the workspace root |
| `/review` | Runs `git diff --cached` and sends the output for AI review |
| `/plan` | Switch to plan agent mode |
| `/build` | Switch to build agent mode |
| `/ask` | Switch to ask agent mode |
| `/debug` | Switch to debug agent mode |
| `/docs` | Switch to docs agent mode |
| `/code` | Switch to code agent mode |
| `/skillname` | Run any installed skill (from `.agents/skills/`) |

Built-in slash commands are handled by the extension itself. Skills are loaded from `.agents/skills/` — each subdirectory with a `SKILL.md` becomes a `/skillname` command.

## Architecture

The extension has two independent compilation targets:

```
src/
├── extension/          # Node.js extension (runs in VS Code's Electron Node)
│   ├── extension.ts    # Activation entrypoint
│   ├── types.ts        # Shared types between webview and extension
│   ├── providers/
│   │   └── SidebarProvider.ts   # Webview view provider, message dispatch
│   └── services/
│       ├── OpencodeCli.ts       # Server process manager, primary API consumer
│       ├── ApiClient.ts         # HTTP client for opencode REST API
│       ├── SseStream.ts         # SSE stream parser
│       ├── EventDispatcher.ts   # SSE event handler dispatch
│       ├── AuthService.ts       # API key management via SecretStorage
│       ├── SessionService.ts    # Session lifecycle management
│       ├── PermissionService.ts # File read permission checks
│       └── readPatterns.ts      # Deny patterns for sensitive files
└── webview/            # React/DOM app (runs in webview)
    ├── index.tsx        # Entrypoint
    ├── App.tsx          # Main app component, message routing
    ├── hooks/
    │   ├── useChatState.ts
    │   ├── useModelManager.ts
    │   └── useMessageHandler.ts
    └── components/
        ├── ChatContainer.tsx
        ├── ChatBubble.tsx
        ├── EventCard.tsx
        ├── ContextGroup.tsx
        ├── CompactionDivider.tsx
        ├── DiffPreview.tsx
        ├── ToolMessage.tsx
        └── ThinkingDots.tsx
```

### Data Flow

1. User types a message → webview posts `sendMessage` via VS Code API.
2. `SidebarProvider` receives the message, calls `OpencodeCli.sendPrompt()`.
3. `OpencodeCli` creates a session, POSTs to `/session/:id/message`, and streams SSE events.
4. `EventDispatcher` routes SSE events to callbacks (content deltas, tool events, permissions, diffs).
5. Events are forwarded to the webview as `ExtensionToWebviewMessage` typed messages.
6. The React app renders messages, tool events, and diffs in real-time.

## Development Setup

```sh
# Clone the repository
git clone <repo-url>
cd opencode-sidebar

# Install dependencies
npm install

# Build everything
npm run compile

# Watch mode (run both in parallel)
npm run watch:extension   # tsc --watch
npm run watch:webview     # esbuild --watch

# Package for distribution
npx vsce package
```

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Full build: tsc + esbuild |
| `tsc -p tsconfig.extension.json` | Extension (Node.js) only, outputs to `out/` |
| `node esbuild.config.js` | Webview (React) only, outputs to `out/webview.js` |
| `npm run watch:extension` | Watch mode for extension |
| `npm run watch:webview` | Watch mode for webview |
| `npx vsce package` | Package .vsix for distribution |

### Project Structure

- `package.json` — Single manifest for both targets (no monorepo)
- `tsconfig.extension.json` — TypeScript config for the Node.js extension target
- `tsconfig.webview.json` — TypeScript config for the React webview target (includes `src/extension/types.ts`)
- `esbuild.config.js` — Webview bundler config
- `AGENTS.md` and `SKILL.md` — User-specific agent configs (gitignored)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension won't activate | Ensure VS Code 1.82+ and the sidebar is visible (View → Open View → Opencode) |
| `opencode serve` starts but chat doesn't respond | Check the Developer Tools console for HTTP errors. The server uses dynamic port allocation via `--port 0`. |
| API key not persisting | Keys are stored in VS Code SecretStorage. Try re-entering the key if it doesn't survive a restart. |
| "Binary not found" error | Install `opencode-ai` globally (`npm install -g opencode-ai`) or set `OPENCODE_BIN_PATH` env var to the full path of the opencode executable. |
| Webview shows blank screen | Run `npm run compile` to rebuild the webview bundle, then reload the VS Code window. |
| SSE streams not arriving | Check network tab in DevTools. The server URL is logged to console as `[opencode] Server started on port: <port>`. |

## Security

Opencode Sidebar Chat always asks for your permission before the AI reads or writes files. Use Allow Once, Always, or Deny to control access. API keys are stored securely in VS Code's SecretStorage.

File read access follows deny patterns that block `.env`, secrets, `node_modules`, and build artifacts by default.

## Changelog

### 0.1.3

- Refactored OpencodeCli into 4 focused services (ApiClient, SseStream, EventDispatcher, OpencodeCli)
- Cross-platform binary resolution with OPENCODE_BIN_PATH env override
- Streaming debounce (80ms) for reduced re-renders
- App.tsx extracted into 3 custom hooks (useChatState, useModelManager, useMessageHandler)
- ChatContainer.tsx extracted into 7 subcomponents
- Deleted dead code (MockOpencode.ts, ChatInput.tsx)
- Unified message-type validation arrays in types.ts
- Turkish UI strings → English
- Minification enabled (1.3MB → 274KB webview bundle)
- Error logging added to silent catch blocks
- JSDoc documentation for core types, services, and public API methods
