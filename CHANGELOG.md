# Changelog

All notable changes to this project will be documented in this file.

## [0.2.3] - 2026-10-02

### Fixed

- The slash command picker was showing only `/new` and `/init`. The command list was built from two sources that could not see most of what opencode offers. `BUILTIN_COMMANDS` named the agents `plan`, `build`, `ask`, `debug`, `docs` and `code`, and the picker dropped any command whose agent was missing from the server's list — but on a machine where plugins own the agents those are _subagents_, never chat modes, so all seven were filtered out. `SkillService` was the second source, and it only scanned `<workspace>/.agents/skills`; skills installed in the global root are outside the workspace, so `/brainstorming` and `/brainstorm-plan` could not appear either. The server itself reports every command it serves on `GET /command` — 528 on a standard install — and the extension now asks for that instead of guessing. The same rule the mode reconciler already follows applies to commands: the server is the only authority on what exists
- A command the server owns is no longer rebuilt locally. opencode expands its own commands, so a prompt starting with `/name` comes back as `<auto-slash-command>` with the arguments substituted; forwarding the literal `/name args` is what triggers it. Substituting a local template would bypass that expansion, and for the global skills there is no local template to substitute. A command that pins an agent now runs under it, while the rest inherit the mode already chosen
- Only name, description, agent and subtask cross to the webview. The raw list is 5.7 MB because the command bodies are 5.2 MB of it; the reduced payload is 141 KB. `mapCommandSummaries` drops the templates for that reason, and a command the server reports twice is listed once
- Typing a slash filter only matched from the start of a name, so `brainstorm-plan` stayed hidden behind `brainstorming` no matter how much of it was typed. The filter matches anywhere in the name or description, and the unfiltered list is capped at 40 rows rather than painting all 528
- Selecting a slash command no longer sends it. Clicking a row in the picker — or pressing Enter on the highlighted one — ran the command immediately, with no way to attach a message first, and most of these commands take arguments, so there was nothing to add. Selecting now fills the field with `/command ` and leaves the cursor there; the user keeps typing and sends when ready, which also routes the turn through the normal send path. `/new` is unchanged: it is a local UI action with no arguments and nothing to type
- A command turn no longer dies with `Model not found: opencode-go/normal-combo`. `runCommand` reaches `processPrompt` without passing through `sendMessage`, so nothing resolved a model for it and the server fell back to its default agent — which pins a model absent from the catalog — failing the turn before it started with HTTP 500. The webview resolves the model for command turns exactly as it does for prompts, and refuses them the same way when no model is picked rather than letting them fail at the server. A workspace skill had the same defect plus a hard-coded `build` mode naming an agent the server does not have; both are gone
- A command that pins an agent runs under that agent and the rest inherit the active mode, so `/brainstorming` no longer changes the chat mode out from under the turn
- An agent's own pinned model is now respected instead of being overridden by whatever the picker held. Every turn sent the picker model, and the picker won whenever the agent was the active one, so the pin never took effect. opencode resolves an agent's pin when a request carries no model, and it is the only party that can, so the model is now left off the request in that case. Measured on this machine: `Prometheus - Plan Builder` (pinned to `omniroute/pro-models`) ran `opencode/mimo-v2.6-flash-free` instead whenever the picker held a free-tier model
- An agent pinned to a model the server does not publish no longer fails silently. `Sisyphus - ultraworker` is pinned to `opencode-go/normal-combo` while the catalog carries that model as `omniroute/normal-combo`, so opencode rejects every turn with `Model not found` — identically in its own TUI, since a request with no model gives the server nothing to second-guess. Trusting the pin blindly traded that error for a different one, so the pin is checked against the catalog first: when it cannot resolve, the picked model is sent as a fallback and the mismatch is reported once. The misconfiguration is still the user's to fix; it is named rather than papered over with a same-named model from another provider
- The picker no longer lists the same command twice when a workspace skill shares a name with a server command, and `/new` appears once even when the server reports a command of that name
- The `question` tool used to leave the turn stuck on `question running…` forever. opencode asks its questions through a tool that blocks until the server receives an answer, and the request only ever arrives as a live `question.asked` event — the extension never handled it, so the sidebar showed nothing interactive, the user had only Abort, and the server waited on an answer nobody could give. The event now becomes an answerable card: options toggle, a typed answer overrides its question, the reply goes to `POST /question/:id/reply`, and a card dismissed with no answers posts to `/reject`. A question that arrives while the view is hidden is rebuilt from `GET /question` on `webviewReady` and raises the same VS Code notification a blocked permission does, so neither prompt can park a turn in silence

### Changed

- The server command list replaces the hard-coded builtins. `BUILTIN_COMMANDS` is now only what the extension implements itself — a fresh session and the `AGENTS.md` scaffold — and `/new` is always kept, since no server command resets the session. Workspace skills still appear, but only when the server did not already report the same name, so a locally-skilled command resolves to the server's richer template instead of the extension's thinner fallback

## [0.2.2] - 2026-10-01

### Added

- Hiding the sidebar no longer throws the conversation away. VS Code deallocates the webview document when a view is hidden and rebuilds it on the next show, so the app used to remount with an empty transcript even though the session was still live in the extension host and on the server — the next prompt silently continued the old session, so the chat looked like it had started from scratch. `webviewReady` now rehydrates: it posts `sessionLoaded` for the live session, including `busy` and the `activeRequestId` the server is still streaming under. `OpencodeCli.getActiveRequestId` reads that id off the prompt map it already keeps, and `SessionService.loadSession` stamps it on the trailing assistant message. Without the stamp the webview finds no target for the next delta and opens a _second_ bubble for a turn that is already on screen
- A **New Chat** button in the bottom toolbar, next to Session History, plus a matching `/new` slash command. Either one starts a fresh session while the previous one stays in session history. Both work mid-stream: `clearChat` dispatches to the same `SessionService.abort()` path as `abort`, so the server stream is stopped and `_currentSessionId` is nulled before the next prompt creates a new session. The `clearChat` message type and its handler already existed — the webview simply never sent it, and never cleared its own transcript
- A permission asked while the sidebar is hidden used to deadlock the turn permanently: the prompt is only ever a live event, the webview that would render it was gone, and history cannot rebuild it, so the server waited forever on a decision nobody could make. `EventDispatcher` now holds the unanswered request, `OpencodeCli` exposes it per in-flight request, `webviewReady` replays it into the fresh webview, and a VS Code notification appears while the view is hidden so the user knows the run is parked
- Agent mode, the hidden-model list, and the provider panel now survive the round trip via `acquireVsCodeApi().setState()`, which VS Code restores on its own after an editor restart. The selected model is left alone — it already round-trips through the extension's `workspaceState`
- `resetConversation()` in `src/webview/hooks/useChatState.ts`, so "what a new chat resets" lives in one place: transcript, context events, busy flag, and every streaming buffer. Model/mode/skill/visibility selection is deliberately preserved; `revertActive` and any pending read-permission or revert-confirmation prompt are cleared, since leaving them set would render the wrong UI over a fresh transcript
- Tool cards no longer imply files were changed. `EventCard` picked its icon and colour from `eventStatus`, so anything that finished — `lsp_diagnostics completed`, `npx tsc …`, `edit completed` — came back with a green tick, and the transcript read as a list of edited files. Green is now reserved for `file_edit`, the one card backed by a diff entry with a non-zero change count. Commands and diagnostics keep a neutral 🔧. Failures still show ❌
- Repeated edits to one file collapse into a single card showing `×N` and the turn's summed `+N −M`. The existing merge in `useMessageHandler` never fired on these: it only compares adjacent messages, and each edit is followed by its own `edit completed` card, so nothing was ever adjacent; it also keyed on `args`/`result`, which file edits do not carry
- Tool cards now survive a rehydrated session. `mapRawMessagesToChatMessages` only flattens text parts, so restoring a session brought back the conversation with none of its cards — no reads, no commands, no edits. Restored cards are built by `toolEventsFromPart`, extracted from the live stream path so the two cannot drift apart, and the session's cumulative diff adds one card per changed file at the end of the transcript. A long turn is trimmed to its last few routine cards with a count in their place; failures are never dropped
- Fixed a trailing newline on every restored message that also ran a tool, and an empty bubble above a message that only ran tools
- Tests for the edit grouping, the completion styling, the shared part mapper, the per-turn trim, and the restored-card payload

### Fixed

- Aborting a turn no longer re-renders the stopped response. `handleAbort` sent `abort` and cleared `busy` but left the 80ms debounce buffer holding text already received from the server, so a pending timer would flush the aborted turn back into the transcript. Both `abort` and New Chat now drop the buffer first
- A turn that ran past five minutes reported `Request failed: fetch failed` and left the UI idle while the server carried on to completion. Current opencode answers `POST /session/:id/message` with the finished message as JSON, so it sends no response header until the turn is over — and undici abandons a fetch whose headers never arrive after 300 seconds. Every turn longer than that killed itself: one measured run lasted 8m24s, failed at exactly the 5-minute mark, and the server then finished the turn 84 seconds later and wrote the answer, which is why the work was still there on re-entry. The prompt now ends on `session.status` idle, which the server emits once per turn and which the extension already parsed but never used as a completion signal, and a POST that dies after the turn has demonstrably started no longer reports a failure at all — the event stream carries the turn to its end. The POST body is now only a backstop for text the stream did not deliver, and a short grace period lets it land alongside the idle event it races. The `/event` subscription also reconnects for as long as the prompt runs, since it is what owns the turn once the POST is gone
- A failed request now says why. `fetch` reports every transport failure as the bare string `fetch failed` and hides the reason in `cause`, so `getErrorMessage` surfaced a message with nothing to act on. It now includes the cause, which is where undici puts `HeadersTimeoutError`, `ECONNRESET` and the rest
- The 30-minute hang detector and the five-minute failure above are the same defect seen from two sides. Neither is a turn budget: a turn still running at five minutes is normal on this machine (a free-tier model spends 30-70s per step, and one session reached fifteen steps), so the fix is to stop treating the client's own HTTP connection as the end of the turn
- A turn that ran past two minutes was silently cut off halfway through its work. `OpencodeCli.sendPrompt` armed a 120-second timer that aborted the POST and the `/event` subscription together and then resolved the prompt as though it had finished: the webview went idle, the transcript froze on a partial reply, and nothing was reported to the user. Aborting the fetch did not stop the server — the turn kept stepping through its loop with no listener attached, so the work was paid for and then discarded. Long turns are ordinary here (a free-tier model spends 30-70s per step, and a session reached fifteen steps in one run), so this was the common path, not the edge case. The deadline is now a 30-minute hang detector, a turn still running at two minutes is left alone, and if the detector does fire it posts `/session/:id/abort` so the server turn stops with it and surfaces a visible error. The test asserts all three: no early cut-off, the server-side abort, and the error
- Text streamed after a tool call no longer lands inside the reply that was written before the tool ran. One turn is several opencode messages — the agent speaks, runs a tool, then speaks again — but `ChatCoordinator` accumulated `fullContent` across the whole request and the webview wrote it into the first assistant message matching `requestId`, so every step was glued into one bubble and the post-tool narration rendered _above_ its own tool cards instead of below them. What arrived in order did not look like it arrived in order. `EventDispatcher` now passes the owning `messageID` with every text and reasoning emission, `ChatCoordinator` accumulates per message id, and `ChatMessage.serverMessageId` keys the bubble, so a step the webview has not seen opens a new bubble appended at the end of the transcript. Reasoning follows the same split and lands on the step it belongs to. The up-front empty assistant placeholder is gone — it would have stayed on screen as a permanent empty bubble — and `streamEnd` now closes every bubble of the turn rather than the first. Restored sessions were already correct, since `mapRawMessagesToChatMessages` emits one message per server message; live and restored now agree
- The mode picker no longer flip-flops on open, announcing a switch each way. The webview seeded its agent list with a guess (`build`, `plan`, `ask`, …) and defaulted the mode to `build`, then reconciled the active mode against that guess before the server had said anything: a valid mode was not in the list, so it switched to `build`; the real `agentList` arrived, did not contain `build` either, and switched back. Both halves were wrong on a machine where opencode plugins own the agents — `build`, `plan` and `review` are _subagents_ there, which `filterChatModeAgents` correctly excludes from chat modes, so the guess named modes the server had never heard of. The list now starts empty and a ref records that the server has answered, so the reconciler only ever runs against the real list; the mode itself starts empty too and adopts the server's first agent silently instead of reporting a switch. An empty list is treated as an answer rather than as "not loaded", since `filterChatModeAgents` can legitimately return nothing
- The slash popup no longer offers modes this server does not have. `/build`, `/plan`, `/debug` and friends were listed unconditionally, but selecting one routed to a mode the server rejects, which the reconciler then undid. Mode-switching commands are now filtered against the server's list, and before the list arrives only the local commands (`/new`, `/init`) are shown, because a mode-switching command cannot be routed yet. Those two stay regardless of the list: they are local actions and never depended on a mode existing

### Known behaviour

- A prompt sent without a model fails with HTTP 500. The default agent on this machine pins `opencode-go/normal-combo`, which is not in the catalog, so the server answers `ProviderModelNotFoundError` before the turn starts. The extension always sends an explicit model, so this only shows up for other clients

- Restoring the transcript covers hiding and showing the view. Reloading the window or restarting VS Code does not: the extension host dies with the window, and with it the local server. Load the session from Session History in that case
- Restored file-change cards appear at the end of the transcript rather than inline. The session diff is cumulative and records no turn, so placing them by timestamp would put them under the wrong message

## [0.2.1] - 2026-09-28

### Added

- A shared `Popup` primitive for every webview overlay. It owns the behaviour only — `role="dialog"`, `aria-modal`, Tab confinement, Escape, and returning focus to the opener — while the caller keeps its visuals through `style` / `backdropStyle`. Backed by `useFocusTrap` and `useEscapeToClose` in `src/webview/hooks/useFocusTrap.ts`; Escape is bound on the capture phase and skipped once another handler has claimed the key, so only the topmost layer closes
- `src/webview/contrast.ts` with `parseCssColor`, `relativeLuminance`, and `contrastRatio`, so palette rules can be asserted instead of re-derived per test file
- `styles.test.ts` fails the build if a text token drops below WCAG AA on any surface, or if a hard-coded copy of a retired colour creeps back in. It also asserts the source walk actually inspected the tree, so the scan cannot pass vacuously
- Links in assistant markdown now open in the user's browser. A `openExternal` message carries the URL to the extension, which re-parses it and checks the protocol against an `http`/`https`/`mailto` allow-list before calling `vscode.env.openExternal`. The check is repeated on the extension side on purpose: a webview message is not a trust boundary, so a forged `file://` or custom-scheme request must not reach the OS handler
- Design scales in `styles.ts` so the values stop being retyped per component: `RADIUS` (4/6/8/12/16), `SHADOW` (`sm`/`md`/`lg`/`sheet`), `FONT_SIZE` (11/12/13/14/16/20/24), and `SPACE` (2/4/6/8/12/16/24). A sixth colour family joins `COLORS`: `onAccent` (`#fff`) for text on saturated fills, `onBright` (`#11111b`) for text on light fills, `scrim` for the second-stage backdrop, and `success`/`accent`/`danger` `Tint`/`Border`/`Fill` triples that were being hand-copied at four different alpha values each
- `withAlpha(hex, alpha)` in `styles.ts`, so a translucent wash is derived from its hue instead of re-typed as an `rgba()` literal. `agentColors.ts` uses it to derive all twelve of its chip washes from eight hues, and `slashCommands.ts` the same for the skill chip
- `hoverable(enter, leave?)` in `src/webview/hover.ts`, the one sanctioned way to attach a hover state. `leave` restores only the keys `enter` set, and may be a function when the resting style depends on state — which is what the hand-rolled ternaries were working around
- Shared popup chrome, so the model manager, session history, model picker, and slash list no longer each hand-write the same body/border/radius/shadow stack: `sheetPanel`, `sheetBackdrop`, `sheetHeader`, `sheetTabs`, and `popupPanel`. They now differ only in `maxHeight` and inset
- More guard tests in `styles.test.ts`: no type size below the scale floor and none off a declared step, padding and gap on an even declared step, no dead export from `styles.ts`, no wholesale `cssText` clear, no hand-rolled `currentTarget.style` mutation, and no duplicated popup chrome outside `styles.ts`. `WebviewHtmlBuilder.test.ts` asserts the heading ladder keeps a real step between levels and that markdown tables scroll

### Changed

- Icon-only buttons in the webview now expose an accessible name through `aria-label`: Session History, Provider Settings, Add file, and Send message. `title` is kept as a hover hint only, because a `title` attribute is not a reliable accessible name
- The `ModelSelector` trigger is a real `<button>` carrying `aria-haspopup="dialog"` and `aria-expanded`. It was a `<div onClick>`, so keyboard users could not open the model picker at all and no focus target existed to restore to on close
- `SlashCommandPopup` is a `role="listbox"` with `role="option"` / `aria-selected` items, and the textarea is wired as a `role="combobox"` with `aria-activedescendant`. It is deliberately not a dialog: focus has to stay in the field the user is typing into, so it gets no `aria-modal` and no focus trap
- `COLORS.textMuted` and `COLORS.textDim` were raised to `#9ca2b8` and `#a6adc8` so every text token clears WCAG AA (4.5:1) on all three surfaces. The previous values measured 1.88-3.59:1 and were used at 10-11px. The old values were hard-coded into 14 components, so every copy was updated too — the token fix alone would have left most of the UI unchanged
- Hard-coded colours are gone from the webview. Around 250 hex and `rgba()` literals across 20 components collapsed to five, all of them the deliberately off-palette agent hues in `agentColors.ts` and `slashCommands.ts` that keep `plan`, `code`, and `review` distinguishable in the transcript. Eighteen components now import from `styles.ts` instead of three
- Touch targets in the webview meet WCAG 2.2 AA 2.5.8. The message action buttons, the markdown copy button, and the shared icon buttons were built from a 10-20px glyph plus padding and measured 16-22px, below the 24x24 floor; `btnBase` and the inline button styles now carry an explicit `minWidth`/`minHeight` rather than relying on padding arithmetic
- 10px type is retired. It appeared in thirteen places — counters, badges, the compaction label, tool output — and is now `FONT_SIZE.xs` at 11px. The 11px floor is deliberate: 11px is also used in thirty places, and moving those to 12px is a visible change to the whole transcript that wants its own review rather than an audit sweep
- Spacing is snapped to the `SPACE` scale. The UI already ran on a 2px sub-grid, so the only genuine violations were the odd values 3/5/7 — seven sites. The 4/8 grid the audit proposed was not applied: rounding 6/10/14 to 4/8/16 across sixty-plus sites would have been a redesign, not a fix
- Every hover state goes through `hoverable()`. The eleven hand-written `onMouseEnter`/`onMouseLeave` pairs mutated `currentTarget.style` directly, with the enter and leave values duplicated and the resting value occasionally drifting from the element's own inline style. `SlashCommandPopup` keeps its state-driven highlight, which is the correct mechanism for a `listbox`
- `agentColors.ts` stores one hue per agent instead of three hand-written colour objects. The four hues outside the app palette stay literal by design; what changed is that the surrounding chrome is derived from the hue and can no longer disagree with it

### Fixed

- Tool calls ran but returned nothing. The opencode server was started with an allow-list of roughly ten environment variables, which omitted `PATHEXT`, so an extensionless command such as `node` could not be resolved to `node.exe`; `ComSpec`, `TEMP`/`TMP`, and `HOMEDRIVE` were missing too, breaking cmd-based tools and anything that writes a temporary file. The model saw empty output, retried, and every retry opened a console window — the same defect presenting as two separate bugs. The child now inherits the host environment, with `PATH` still prefixed by the system directories. Every inherited `OPENCODE_*` override is then stripped case-insensitively before an explicit pass-through set is re-added, so an outer variable still cannot re-point the binary, the config, or the permission set
- Keyboard focus had no visible ring: interactive controls in the webview set `outline: none` inline, which no stylesheet rule can override, so the global `:focus-visible` outline was dead on arrival. The outline now survives for keyboard users, and it is suppressed only for `:focus:not(:focus-visible)` so mouse clicks stay quiet while Tab navigation is clearly highlighted
- The message action buttons (Revert, Copy) and the markdown Copy button were revealed by mouse hover handlers, so they stayed invisible when reached by keyboard. Visibility is now driven by `:hover`, `:focus-within`, and `:focus-visible` in the stylesheet instead of inline opacity, and `:focus-within` keeps the button visible for as long as focus is inside the message
- Hovering a message and then triggering a React re-render could make its buttons disappear, because the re-render restored the inline `opacity: 0` the hover handler had overwritten
- No overlay exposed dialog semantics. `ConfirmDialog`, `ProviderPopup`, and `SessionListPopup` had no `role="dialog"` or `aria-modal`, none responded to Escape, and none trapped Tab or returned focus on close. `ConfirmDialog` also now focuses **Cancel** rather than the destructive Revert action, so a stray Enter cannot revert a message
- Session rows in `SessionListPopup` nested the delete `<button>` inside the row `<button>`, which is invalid HTML and left the delete control out of the accessibility tree entirely. The row is now a wrapper with two sibling buttons, and the trash control has an `aria-label` instead of relying on the 🗑 emoji
- Streaming assistant text was never announced. The reply body now renders inside an `aria-live="polite"` region with `aria-atomic={false}`, and the blinking streaming cursor is `aria-hidden` so it does not re-announce on every frame
- The user message bubble drew `#cdd6f4` on the purple fill, a 3.94:1 contrast ratio — below AA for its 13px text. It is now white, at 5.70:1
- Links in assistant markdown looked clickable and did nothing. Every non-anchor `href` called `e.preventDefault()` and stopped there, and no message anywhere in the codebase carried a URL to the extension
- Wide markdown tables stretched the message bubble sideways. `pre` already scrolled horizontally; `table` had neither `overflow-x` nor a scroll container, and now behaves the same way
- `h4` in assistant markdown rendered at 13px, identical to the 13px body it was meant to stand out from, and `h3` at 14px left almost no step above it. The ladder is now 20/16/14 with `h4` and below carrying no size rule at all — they separate by their existing 600 weight and block margins rather than by a size they do not have. A four-step ladder does not fit a 13px surface

### Removed

- `src/webview/hooks/useHoverStyles.ts`. It had no importers, and both of its reset helpers did `style.cssText = ''`, which clears React's own inline styles and not just the hover state — the component would have lost its styling for as long as the mouse rested on it. `hoverable()` replaces it with key-scoped resets
- Eight dead exports from `styles.ts` (`flexBetween`, `flexCol`, `flexCenter`, `inputBase`, `textNormal`, `btnAccent`, `transitionColor`, `gap`). A dead export is worse than a missing one: it reads as an available option, so the next author reaches for the wrong primitive instead of writing the right thing. `styles.test.ts` now fails the build if one reappears

## [0.2.0] - 2026-09-25

### Added

- Chat mode list is built from the server's agent catalog: only agents that can own a session are offered, and opencode's internal agents (`compaction`, `summary`, `title`) are excluded
- Selecting a mode that pins its own model seeds the model picker with that model, so the shown model matches what the server will run
- A turn that finishes without any text now renders a `No response text` marker instead of a bare badge, so an empty reply is distinguishable from a rendering glitch
- The chat footer flags a model substitution with `⚠ asked for <model>` when the server ran a model other than the requested one, with both ids available as a tooltip
- System notices when the extension changes something on the user's behalf: a mode that is not offered by the server, and a saved model that the refreshed catalog no longer exposes

### Changed

- File-edit and tool-result cards start collapsed; failed events still expand so the error stays visible
- Provider, model, and agent identifiers are shown as the picker displays them, instead of raw `providerId/modelId` values
- The model picker is the single source of truth for the active mode: a manual change always wins, and an agent's pinned model is only used for a mode that was not selected through the picker
- Sending is refused while no model is selected, instead of letting the server fall back to the agent's own model

### Fixed

- Windows: child processes (`opencode serve`, git commands) no longer open a console window
- Provider failures now surface the real message. opencode wraps errors as `{ name, data }`, so reading a flat `message` reported "Unknown error" for explicit failures such as a `403`
- Errors carried by the `POST /session/:id/message` response body are reported when the event stream did not deliver them, and the same failure is reported only once per turn
- Model pinning by an agent could silently override the selected model, because the extension could send a prompt before the model catalog had loaded

### Security

- The published VSIX now contains the compiled runtime and its assets only. `.vscodeignore` is an allow list, so development-only files (skill libraries, coverage reports, review and security documents, local tool configuration, and server logs) are no longer packaged

## [0.1.9] - 2026-09-24

### Fixed

- Assistant replies were blank on opencode 1.18+: `POST /session/:id/message` now returns `application/json` instead of an SSE stream, so the response was parsed as an empty stream. `OpencodeCli.sendPrompt` now branches on the response content type and applies the JSON message body
- Live assistant text, reasoning, and tool events now stream from the server `GET /event` endpoint while a prompt runs
- The user's own prompt text was echoed into the assistant bubble; event parts are now filtered by message role
- The opencode CLI is resolved from the machine (env override, npm prefix, native install location, `PATH`) instead of being bundled, so opencode updates do not require an extension update
- A saved model that the server no longer offers caused `HTTP 500 ProviderModelNotFoundError` and a blank bubble; stale selections are now repaired
- Model IDs containing slashes are split on the first separator only
- Failed turns render the error in the chat instead of leaving an empty bubble

## [0.1.8] - 2026-09-24

### Added

- Contributor setup, validation, commit, and pull request guidance
- Architecture documentation covering extension/webview boundaries, services, data flow, and security
- ADRs for local Opencode server lifecycle and typed webview message contracts
- OpenAPI 3.1 contract for HTTP endpoints consumed by `ApiClient`
- JSDoc for `SidebarProvider` lifecycle/validation methods and `EventDispatcher` private handlers
- Prettier, Husky pre-commit, and lint-staged quality tooling
- GitHub Actions CI for formatting, lint, typecheck, tests, build, high-severity audit, and VSIX packaging
- Dependabot dependency updates and CodeQL security analysis
- Regression coverage for workspace symlink containment, malformed webview messages, request ordering, timeout cleanup, and session mutation failures

### Changed

- Server lifecycle, shared types, and application services further separated from `OpencodeCli`
- Chat message rendering and scrolling now use windowing to reduce React work on long sessions
- Development baseline synchronized to Node.js 20 and VS Code 1.85
- Webview messages now require a trusted `vscode-webview:` origin

### Fixed

- Provider credentials and permission behavior hardened across extracted services
- Concurrent server startup requests now share one process and stale exits cannot corrupt live server state, preventing orphan processes and incorrect URL/auth data
- Untrusted-origin webview messages are ignored before payload handling

## [0.1.7] - 2026-09-22

### Added

- CHANGELOG.md back up to date (0.1.5 and 0.1.6 entries were missing from the Marketplace release)

## [0.1.6] - 2026-09-22

### Added

- Binary candidate fallback: `OpencodeCli` now resolves an ordered list of binaries (`OPENCODE_BIN_PATH` → platform-specific installs → `PATH`) and tries each on startup instead of trusting a single one
- Captured `opencode serve` stderr is included in error messages, so real causes (e.g. an invalid `opencode.json`) reach the UI instead of a bare "exited with code 1"

### Fixed

- Stale `OPENCODE_BIN_PATH` (e.g. left behind by an old npm install) no longer breaks server startup for the whole extension
- "Failed to list providers: opencode serve exited with code 1" now surfaces the underlying configuration error

### Changed

- `start()` split into candidate loop + per-candidate `tryStart()` with a shared 30s deadline

## [0.1.5] - 2026-05-08

### Added

- `OpencodeCli` service owning server lifecycle, HTTP API client, SSE streaming, and event dispatch
- Agent-based mode selection and command routing in the sidebar UI (`/plan`, `/build`, `/ask`, `/debug`, `/docs`, `/code`, `/review`, `/init`)

### Changed

- `sendPrompt` and related call sites migrated to the new service layout

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
