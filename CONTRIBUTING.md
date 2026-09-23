# Contributing

## Prerequisites

- Node.js 20+
- VS Code 1.85+
- `opencode-ai` installed globally or available on `PATH`
- Git

## Setup

1. Run `npm install`.
2. Run `npm run compile`.
3. Open repository in VS Code.
4. Run extension with `F5` (Extension Development Host).

## Development Loop

- Extension TypeScript: `npm run watch:extension`
- Webview bundle: `npm run watch:webview`
- Full build: `npm run compile`
- Tests: `npm test`
- Lint: `npm run lint`
- Format all files: `npm run format`
- Validate changed files before commit: Husky runs Prettier check and ESLint fixes through lint-staged
- Run every CI gate locally: `npm run validate`

Before opening a pull request, run:

```text
npm run validate
```

## Change Rules

- Keep extension-host code under `src/extension`; keep React/DOM code under `src/webview`.
- Put communication contracts in `src/shared/types.ts` and update both sides together.
- Use services for Opencode server lifecycle, HTTP, SSE, permissions, sessions, and skills.
- Never log or commit provider keys. Store keys only through `AuthService` and VS Code SecretStorage.
- Preserve denial behavior in `src/extension/services/readPatterns.ts` when expanding read access.
- Add or update tests for behavior changes. Documentation-only changes still require full validation.
- Update `docs/openapi.yaml` whenever an `ApiClient` endpoint or payload changes.
- Add user-visible changes to `CHANGELOG.md` under `Unreleased`.

## Commit Style

Use Conventional Commits:

- `fix: handle stale binary path`
- `feat: add session search`
- `docs: document API contract`
- `refactor: isolate server lifecycle`
- `test: cover permission responses`

Keep subject concise and imperative. Explain non-obvious reason in body.

## Pull Requests

Include:

1. Problem and user impact.
2. Implementation summary.
3. Validation commands and results.
4. Screenshots for webview changes.
5. Security and compatibility notes when relevant.

Do not include generated `out/`, `coverage/`, API keys, local settings, or unrelated formatting changes.
