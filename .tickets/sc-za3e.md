---
id: sc-za3e
status: closed
deps: []
links: []
created: 2026-09-10T00:33:31Z
type: feature
priority: 1
assignee: cc-vps
tags: [phase-1, diagnostics, api-safety, rate-limit]
---
# Add privacy-safe opt-in HTTP request statistics

Operators of an unofficial, rate-limited API client need a way to verify actual request volume and diagnose 401/429 behavior without logging credentials or personal response data. Add opt-in aggregate HTTP statistics at the StrongClient request boundary so every real fetch attempt—including retries and token refreshes—is measurable while normal command output remains unchanged.

## Design

Provide an explicit flag or environment switch such as STRONG_HTTP_STATS=1. Emit a concise aggregate report to stderr after the command. Count actual fetch attempts, normalized endpoint categories, status classes/codes, retry attempts, token refreshes, received byte totals, elapsed time, and relevant cache provenance when available. Normalize routes into categories such as log page, single-log detail, user metadata, global measurement page, and auth refresh. Never emit raw URLs, query strings, continuation tokens, entity IDs, headers, tokens, or request/response bodies. Keep JSON stdout parseable. Centralize instrumentation around rawRequest/authedRequest rather than duplicating counters in commands.

## Acceptance Criteria

- With diagnostics disabled, command stdout/stderr behavior is unchanged.
- With diagnostics enabled, stderr reports total real HTTP attempts and per-category counts, including retries and refresh attempts.
- Successful JSON output on stdout remains independently parseable.
- Statistics include response-byte totals and elapsed time without retaining or printing response bodies.
- Route labels contain no user IDs, workout IDs, continuation cursors, or other sensitive values.
- Tests cover success, 401-refresh-retry, 429/5xx retry, terminal failure, and redaction/privacy guarantees.
- Documentation includes safe usage examples and explicitly warns against raw transport/body logging.
- Build, unit tests, lint, package test, and typecheck pass.

