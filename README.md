# Opencode Sidebar Chat

![Logo](resources/logo.png)

**Opencode Sidebar Chat** is an AI coding assistant for Visual Studio Code. It connects to the Opencode CLI and provides a chat interface in the VS Code sidebar with multi-provider support. Note: "This is an unofficial community extension and is not affiliated with or endorsed by Opencode.ai."

## Features

- **Multi-Provider Chat**: Switch between AI providers and models directly from the sidebar.
- **File Change Cards**: AI-edited files appear as clickable cards in chat — click to open the file in VS Code.
- **Permission Controls**: Granular Allow/Always/Deny prompts for file access.
- **Event Stream**: See tool calls, reasoning, and context gathering in real-time.
- **Session Management**: Browse, load, and delete past chat sessions.
- **Diff Visualization**: Bar charts show add/delete stats for each changed file.

## Installation

1. Install the extension from the VS Code Marketplace.
2. Click the **Opencode** icon in the sidebar.
3. Start chatting — the extension automatically starts an `opencode serve` backend.

## Security

Opencode Sidebar Chat always asks for your permission before the AI reads or writes files. Use Allow Once, Always, or Deny to control access.