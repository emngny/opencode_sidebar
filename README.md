# Opencode Sidebar Chat

![Logo](resources/logo.png)

**Opencode Sidebar Chat** is an AI coding assistant for Visual Studio Code. It connects to the Opencode CLI and provides a chat interface in the VS Code sidebar with multi-provider support.

> This is an unofficial community extension and is not affiliated with or endorsed by Opencode.ai.

## Features

- **Multi-Provider Chat**: Switch between AI providers and models directly from the sidebar. API keys go to VS Code's SecretStorage, never to `settings.json`.
- **Server-driven agent modes**: The mode list comes from the server, so you get the agents your setup actually provides rather than a fixed list.
- **Live tool transparency**: Tool calls, reasoning, and context gathering stream in as they happen, in the order the agent produced them.
- **File change cards**: AI-edited files appear as clickable cards showing `+N −M`, repeated edits to one file collapse into a single card, and clicking opens the file. Reverts undo a whole turn via git snapshots.
- **Permission controls**: Allow Once / Always / Deny on tool use and on reads of sensitive paths. A permission asked while the sidebar is hidden surfaces as a notification instead of deadlocking the turn.
- **Interactive questions**: When the agent asks through opencode's `question` tool, the options render as a card with selectable answers and a free-form box; a question asked while the sidebar is hidden is rebuilt from the server's pending list rather than leaving the turn parked on a prompt nobody can see.
- **Session management**: Browse, load, and delete past sessions. Hiding and showing the sidebar keeps the live conversation, including a turn that is still running.
- **Long turns that survive**: Turns routinely run for many minutes. The transcript stays live for as long as the server is working, rather than cutting off on an HTTP client's patience.
- **File attachment and search**: `@` to search workspace files, `Ctrl+V` to paste images.
- **Skills**: any directory under `.agents/skills/` with a `SKILL.md` becomes a `/skillname` command.

## Prerequisites

**opencode CLI** installed, globally or anywhere on `PATH`:

```sh
npm install -g opencode-ai
```

VS Code 1.85 or newer. That is the whole list — the extension brings everything else, including Node.

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

| Command      | Description                                                  |
| ------------ | ------------------------------------------------------------ |
| `/new`       | Starts a fresh session; the current one stays in the history |
| `/init`      | Creates a template `AGENTS.md` in the workspace root         |
| `/review`    | Runs `git diff --cached` and sends the output for AI review  |
| `/skillname` | Run any installed skill (from `.agents/skills/`)             |

Built-in slash commands are handled by the extension itself. Skills are loaded from `.agents/skills/` — each subdirectory with a `SKILL.md` becomes a `/skillname` command.

The mode-switching commands (`/build`, `/plan`, `/ask`, `/debug`, `/docs`, `/code`, `/review`) are **not hard-coded**. The server decides which agents can own a session — `GET /agent` reports a `mode` per agent, and only `primary` and `all` entries qualify, because a subagent can pin its own model and would silently ignore the one chosen in the picker. The popup shows exactly what your server offers, so on a machine where plugins own the agents the list is whatever those plugins declare. Nothing is shown until the server has answered.

## How It Works

The extension runs `opencode serve` as a child process on a random loopback port and speaks to it over
HTTP with a Basic Auth password it generates for that launch. Nothing leaves your machine except the
model request itself, which goes to whichever provider you configured. No ports need to be opened and
no configuration is required.

Your prompt reaches the server, the model streams back token by token over an event stream, and the
sidebar renders it live. Tool calls, reasoning, and file edits appear as they happen — in the order the
agent produced them, so narration that follows a tool appears below that tool rather than merging into
the reply before it.

A turn ends when the server says it is finished, not when the HTTP request returns. This matters
because a single turn often runs for many minutes on a free-tier model, and the transcript has to stay
live for all of it. The sidebar also survives being hidden and shown again: the conversation is
restored, including a turn that is still running.

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history
- [ARCHITECTURE.md](ARCHITECTURE.md) — components, runtime boundaries, data flow, security model
- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, build commands, pull request process
- [docs/openapi.yaml](docs/openapi.yaml) — HTTP endpoints consumed by the extension
- [docs/adr/](docs/adr/) — accepted structural decisions

## Troubleshooting

| Issue                                            | Solution                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension won't activate                         | Ensure VS Code 1.85+ and the sidebar is visible (View → Open View → Opencode)                                                                                                                                                                                                       |
| `opencode serve` starts but chat doesn't respond | Check the Developer Tools console for HTTP errors. The server uses dynamic port allocation via `--port 0`.                                                                                                                                                                          |
| API key not persisting                           | Keys are stored in VS Code SecretStorage. Try re-entering the key if it doesn't survive a restart.                                                                                                                                                                                  |
| "Binary not found" error                         | Install `opencode-ai` globally (`npm install -g opencode-ai`), or point `OPENCODE_BIN_PATH` at the executable. The path is only accepted inside the npm global root and the local `node_modules`, and a rejected value is logged as `OPENCODE_BIN_PATH not in allowed directories`. |
| Webview shows blank screen                       | Run **Developer: Reload Window**. If it persists, you are on a stale build — see [CONTRIBUTING.md](CONTRIBUTING.md).                                                                                                                                                                |
| Chat looks empty after reopening the sidebar     | The transcript is restored automatically when the view is hidden and shown again. Reloading the window or restarting VS Code is not covered — the extension host dies with the window and takes the local server with it, so load the session from Session History.                 |
| A turn stops partway with `Request failed`       | Open Developer Tools (Help → Toggle Developer Tools) and read the console: the underlying network reason is now printed instead of a bare `fetch failed`. Turns longer than five minutes are handled and should no longer fail.                                                     |
| "Binary not found" error                         | Install `opencode-ai` globally (`npm install -g opencode-ai`), or set `OPENCODE_BIN_PATH` to the executable. Only paths inside the npm global root or a local `node_modules` are accepted; a rejected value is logged as `OPENCODE_BIN_PATH not in allowed directories`.            |
| An HTTP 500 on the first message                 | Your agent config pins a model that is not in the catalog. The extension always sends an explicit model, so this points at your `~/.config/opencode/opencode.json` rather than at the extension.                                                                                    |

## Security

- **Tool permissions.** Every tool call is surfaced for a decision: Allow Once, Always, or Deny. A permission requested while the sidebar is hidden cannot be rebuilt from history, so it is held and re-raised as a VS Code notification rather than left blocking the server forever.
- **API keys** go to VS Code's SecretStorage and are restored into the server's own auth store on startup. They are never written to `settings.json` or to the workspace.
- **Read deny patterns.** Reads of `.env`, secret files, `node_modules`, and build artifacts are blocked by default, and a path outside the workspace cannot be resolved.
- **Local server auth.** The spawned `opencode serve` gets a random 16-byte password per launch, sent as Basic Auth. The password lives in memory only and is wiped on shutdown.
- **Webview isolation.** The webview's Content-Security-Policy restricts `connect-src` to the exact dynamic port the server was assigned. Links opened from assistant markdown are re-parsed and scheme-checked on the extension side, because a webview message is not a trust boundary.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the entries explain _why_ a change was needed, not just what changed.
