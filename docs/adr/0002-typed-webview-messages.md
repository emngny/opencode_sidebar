# ADR 0002: Use Typed Message Envelopes at the Webview Boundary

- Status: Accepted
- Date: 2026-09-24

## Context

React webview and extension host run in separate JavaScript realms. Plain object messages can be incomplete, malformed, or stale, especially for commands carrying paths, provider IDs, and permission decisions.

## Decision

Define discriminated `WebviewToExtensionMessage` and `ExtensionToWebviewMessage` unions in `src/shared/types.ts`. Validate every incoming webview message at the extension boundary before routing. Use thin `postMessage` wrappers rather than direct webview access outside the provider.

## Consequences

### Positive

- Compiler checks both communication directions.
- Invalid payloads are rejected before side effects.
- Command additions have explicit payload contracts.
- Webview and extension code can evolve against one shared source of truth.

### Negative

- Adding a message requires updates across shared types, sender, receiver, and tests.
- Runtime validation remains necessary because TypeScript types disappear at runtime.
- Large evolving unions can increase maintenance cost.

## Alternatives Considered

- Untyped `any` messages: rejected because malformed data reached services and UI unpredictably.
- Direct `acquireVsCodeApi` event channels: rejected because business logic would leak into presentation code and weaken testability.
