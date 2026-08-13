---
id: sc-ws3y
status: closed
deps: []
links: []
created: 2026-08-06T21:04:34Z
type: task
priority: 3
assignee: cc-vps
tags: [api, resilience, tech-debt]
---
# api: hardcoded 5xx backoff and non-retryable 429 soft rate limits

Retry-policy backlog (P3). src/api/client.ts authedRequest() retries 5xx with a hardcoded 250/500ms schedule (attempt < 2, sleep(250 * attempt)) and treats 429 (the documented soft rate limit that can also surface as 401 with body Something went wrong. Please try again later.) as a terminal failure. If soft limits are hit in practice, repeat runs waste the user's quota and degrade UX.

## Design

Make backoff env-tunable: e.g. STRONG_RETRY_BACKOFF_MS / STRONG_MAX_RETRIES with current values as defaults. Treat 429 as retryable with a longer, jittered backoff (the backend soft-limit message appears in both 401 and 429 — only retry 429 when it is clearly rate limiting, and keep 401-after-refresh behavior as-is). Consider reusing the existing sleep() helper and documenting the new env vars in README or help text. Note: pagination already paces requests (DEFAULT_PAGE_DELAY_MS = 150) — the retry change is about single-request failures.

## Acceptance Criteria

New env vars (or documented equivalents) for backoff/retry counts with current values as defaults. 429 retries with backoff; 5xx schedule unchanged or improved. Unit tests cover: retry-then-success, retry-exhaustion, and 429-with-soft-limit-body. Existing 78 tests pass.

## Notes

**2026-08-07T12:00:00Z**

Shipped in PR (chore/polish-cache-retry-folders-config). `RetryPolicy` on `StrongClientOptions` (defaults `maxRetries: 2`, `baseDelayMs: 250`, `retryRateLimited: true`); `authedRequest` retries 5xx and 429 with **jittered** backoff (`base × attempt × 0.75–1.25`) — jitter avoids synchronized re-collisions on the rate limiter. Env-tunable via `STRONG_MAX_RETRIES` / `STRONG_RETRY_BACKOFF_MS` (wired in factory.ts; invalid values ignored). 401-after-refresh behavior unchanged (refresh once, then terminal — the soft-limit 401 variant is intentionally left as-is per ticket design). README env table + `strong --help` env section updated. Tests: retry-then-success (5xx, 429), exhaustion (429, custom maxRetries), `retryRateLimited: false` passthrough. Closed.

