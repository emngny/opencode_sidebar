# ADR 0001: Use a Child Opencode Server Process

- Status: Accepted
- Date: 2026-09-24

## Context

The extension needs Opencode session, provider, permission, model, file-change, and streaming capabilities. VS Code webviews cannot safely manage credentials, spawn processes, or call the Opencode server directly. The Opencode CLI already exposes an HTTP/SSE server contract.

## Decision

Run `opencode serve` as an extension-host child process on an ephemeral local port. Extension-host services call its REST API and subscribe to `/event` over SSE. Webview communicates only with extension host through typed `postMessage` envelopes.

## Consequences

### Positive

- Credentials and process control remain outside webview sandbox.
- Opencode server remains source of session and model behavior.
- Streaming and permission events use one authenticated local server.
- Server can be restarted independently from webview render lifecycle.

### Negative

- Extension must discover and monitor a compatible Opencode binary.
- Startup, stderr capture, health checks, and shutdown add lifecycle complexity.
- HTTP/SSE schema drift requires compatibility handling.
- Users need Opencode CLI installed.

## Alternatives Considered

- Call Opencode CLI commands for every request: rejected because streaming and event subscriptions would remain fragmented and slow.
- Connect directly from webview: rejected because secrets, CORS, CSP, and process boundaries would expand attack surface.
- Embed Opencode runtime: rejected because lifecycle and version coupling would duplicate server responsibilities.
