# Changelog

All notable changes to this project will be documented in this file.

## [0.1.4] - 2026-05-07

### Added
- Unit tests (57 tests across 7 test files)
- Integration tests for extension↔webview message protocol
- Payload validation in SidebarProvider
- Crypto-secure random IDs (`crypto.getRandomValues()`)

### Changed
- EventDispatcher: 200+ line dispatch() split into 8 handler methods
- SidebarProvider: _handleSendMessage refactored into 5 methods (context, streaming, diffs)
- normalizeDiff deduplicated to utils/diffUtils.ts
- READ_TOOLS Set unified (removed duplicate array)
- sendPrompt: positional params → options object
- AppContext provider for centralized state
- 30+ console.log statements removed for production
- SSE parser now supports event:, id:, retry:, multi-line data
- SseStream reconnect with exponential backoff (3 retries)
- readPatterns: regex caching + case-insensitive matching
- opencode binary path validation (restricted to allowed dirs)

### Fixed
- sessionPartDeltas unused Map removed (memory leak)
- _processPrompt: missing reasoning/diff callbacks added
- PermissionService: cache hit Promise never resolving
- _loadSkills: dead code (unused readDirectory call) removed
- GitInfo duplicate interface removed
- providerPopup apiKeyInputs ref→state (re-render trigger)
- streamEnd race condition (streamEndedRef)
- receiveChunk debounce race condition
- stale closure in useMessageHandler
- dispose(): _view cleanup added
- handleDeleteOld(0): now deletes all sessions
- SlashCommandPopup: global keydown conditional
- OPENCODE_BIN_PATH: only allowed directories accepted
- CSP connect-src: null port fallback removed
- CSP base-uri: added
- hardcoded Windows paths removed (C:\opencode, C:\Program Files)
- password prefix removed (pure random)
- API error body log sanitized
- SSH/AWS/Kube/Azure credential patterns added
- Windows SIGTERM (was SIGKILL)
- DOMPurify URI safelist tightened
- git diff command injection prevention
- payload type index signatures removed
- 7 test files added

### Removed
- Unused sessionPartDeltas Map
- Duplicate READ_TOOLS array
- Unnecessary console.log statements
- Hardcoded Windows binary paths
- Predictable password prefix (oc-vsc-)

## [0.1.3] - 2026-05-07

### Added
- JSDoc documentation for core types, services, and public API methods (38 symbols across 9 files)
- Webview-ready handshake — server startup triggered by webview mount instead of fragile 500ms timeout
- Cross-platform binary resolution with additional macOS/Linux paths (`~/.local/bin`, `/snap/bin`, etc.)
- Cross-platform signal handling — `kill()` on Windows, `kill('SIGTERM')` on Unix
- `prefers-reduced-motion` media query — disables animations for motion-sensitive users
- `:focus-visible` styles — keyboard navigation focus indicators
- CHANGELOG.md

### Changed
- Refactored OpencodeCli into 4 focused services: ApiClient, SseStream, EventDispatcher, OpencodeCli
- Streaming debounce (80ms) — reduced React re-renders from 10-100/sec to ~12/sec
- Extracted App.tsx into 3 custom hooks: useChatState, useModelManager, useMessageHandler
- Extracted ChatContainer.tsx into 7 subcomponents
- Single SSE stream — removed POST response stream, use only /event endpoint
- Session Maps (sessionPartDeltas/sessionPartTypes) now pruned on session idle
- `/review` slash command now switches to Review mode when text follows (e.g., `/review refactor this`)
- AGENTS.md context tools list now includes `websearch`, `search`
- AGENTS.md event types list now includes `discovery`
- Turkish UI strings → English

### Fixed
- Duplicate start() calls in SidebarProvider — removed race condition
- Binary resolution on Windows signal handling

### Removed
- Diff polling — single getSessionDiff fallback
- Dead code: MockOpencode.ts, ChatInput.tsx
- Unregistered `opencode.run` command from package.json
- Inline require() — replaced with ES imports

## [0.1.2] - 2024-12-19

### Added
- Core extension interfaces for chat, session management, and communication protocols
- Sidebar provider and Opencode CLI service integration

## [0.1.1] - 2024-11-07

### Added
- Initial release
- Chat UI in VS Code sidebar
- Opencode CLI integration
- Multi-provider support