# Review follow-ups (PR #95 spike review)

Issues identified during the PR review of the strong-cli spike, with the ones
**addressed in this revision** and the remaining **deferred follow-ups** (each
with a priority and a short assessment).

Priorities: **P1** = should fix before relying on the tool (correctness /
reliability risk) · **P2** = worth fixing when next touching the area ·
**P3** = nice-to-have / acceptable as-is for a spike.

## Addressed in this revision

| Issue | Fix |
|---|---|
| `workout <id>` fetched **all** workout logs via `loadWorkoutData()` just to find one id (O(n) per detail view) | Now uses the single-log endpoint `GET /api/users/{userId}/logs/{logId}`; the `not found` UX (404 or non-workout log type) is preserved |
| `handlePipeErrors` did `throw` inside a stream `'error'` event handler — becomes an unhandled rejection the top-level `try/catch` cannot observe | Now exits with code 1 (EPIPE still exits 0) |
| `auth whoami` manually re-parsed the status subcommand via `statusCmd.parseAsync()` (bypassed `exitOverride`, own option set) | `whoami` is now a native commander `.alias('whoami')` of `status` |
| `runCli`'s injected `fetch` (for tests) was dead code — `__strongCliFetch` was written but never read by the client factory | `createClient()` now passes the injected fetch through (falls back to `globalThis.fetch`) |

Test count: 32 → **37 unit tests** (`tests/unit/cli-main.test.ts` +
`tests/unit/commands.test.ts`), covering the stream-error exits, the
single-log fetch path (asserts the bulk `include=log` endpoint is never hit),
404 → "not found", and the `whoami` alias.

## Addressed after PR #95 (pagination safety guard)

| Issue | Fix |
|---|---|
| `getAllLogs` followed `_links.next` with **no max-pages cap, no pacing, and no loop detection** — a malformed/self-referencing `next` could loop forever; `getAllMeasurements` had the same shape | Both walks now accept `PaginationOptions` (`maxPages = 10_000`, `pageDelayMs = 150` defaults, both exported). `getAllLogs` throws `ApiError` when a continuation token repeats (loop) or when the page cap is reached — **throwing instead of silently truncating**, since a partial history would corrupt `stats`/`export` output. Page requests are spaced `pageDelayMs` apart to avoid tripping the soft rate limiter. +5 unit tests (cap, loop-detection, pacing, measurements pagination + cap). |

## Deferred follow-ups

### P1 — CI workflow

No CI config exists in the repo for experiments; the PR description claims
typecheck/build/tests pass but nothing enforces it (including the 80/70/80/80
coverage thresholds in `vitest.config.ts`, which are only checked when
`--coverage` is run).

**Assessment**: other experiments in this repo also lack CI, so this is a repo
-level decision; but the coverage thresholds are currently unenforced dead
config. Add a minimal `.github/workflows` (typecheck + unit tests) or drop the
thresholds until they are enforced.

### P2 — `--since` / `--limit` filtering happens client-side after fetching everything

**Resolved by the log cache (addressed with the pagination guard).** Live
probing settled the question: the API pages in **lastChanged (modification)
order, oldest first** — `startDate` is scrambled across pages, so there is no
server-side date filter to lean on and no early-termination for `--since`
(verified against the live account: 1 828 logs, 75 pages, page 1 spans
2020-11 → 2018-08). The fix is the local cache (`src/lib/cache.ts`, JSON in
the config dir, per-user): first run walks the full stream and stores the
continuation cursor; later runs resume from it (re-fetch is idempotent —
verified live — so the merged cache stays consistent) and only download what
changed. `--since`/`--limit`/`stats --weeks` now filter over the cache. The
API rejecting a stale cursor (HTTP 400) triggers an automatic full re-walk;
pass `--fresh` for an explicit one. Deleted workouts are not tombstoned by
the API, so `--fresh` is the only way to drop them from the cache.

### P2 — Keyring path is untested

`keytar` is an `optionalDependency`; `config.test.ts` covers the config-file
and env stores, but the keyring store silently returns `null` when keytar is
unavailable, so the default `auth login` path is only exercised live.

**Assessment**: acceptable for a spike (keyring is an OS-integration concern),
but worth a stub/mock test if the CLI becomes a daily driver.

### P2 — `setEnv()` module-level mutable singleton

`run.ts` and tests mutate a module-global env; Vitest runs test files in
parallel by default, so a future test file that doesn't reset the env could
inherit another file's `XDG_CONFIG_HOME`.

**Assessment**: currently safe (only `config.test.ts` mutates it, and it
resets in `afterEach`), but the new `commands.test.ts` also exercises this
path. If more CLI-level tests are added, consider per-invocation env plumbing
or serial test runs.

### P3 — JWT claims are decoded but never validated

`decodeJwt` reads `exp` / `nameidentifier` without verifying the signature
(by design — the token comes from our own TLS login) and without sanity-
checking `exp` bounds or `iat`/`nbf`. A tampered `session.json` with a huge
`exp` would be accepted silently.

**Assessment**: acceptable threat model for a personal read-only CLI (documented
in `docs/auth-findings.md`); the server response is trusted over TLS. Revisit
only if the tool is shared or used with third-party session files.

### P3 — 5xx retry backoff is hardcoded

`authedRequest` retries 5xx twice with `250ms` / `500ms` sleeps, no env
override. The docs warn about soft rate limiting that returns 401/429, which
this loop does not back off on (429 retries as a generic 5xx? No — 429 is not
`>= 500`, so it fails through immediately).

**Assessment**: fine for now; if soft rate limits are hit in practice, add an
env-tunable backoff and treat 429 like a retryable error.

### P3 — `fmtSet` hardcodes `kg` / `m`

**Resolved (unit conversion).** Live probing showed the API stores **canonical
metric values** (set weights arrive in kg, distances in m; `22.6796185` kg =
exactly 50 lb, `1609.34` m = exactly 1 mi, on a POUNDS/MILES account) — so
label-only fixes would still have mislabeled kg volumes as pounds. New
`src/lib/units.ts` converts for display (kg→lb, m→mi/km) while JSON keeps
canonical metric values + unit metadata; missing preferences default to
POUNDS/MILES. `fmtSet` (workout detail), volume columns/labels (workouts,
stats) and the detail Total line all convert now.

### P3 — Biome config version drift

`biome.json` pins `$schema 2.3.11` but the installed CLI is 2.5.7 (schema
mismatch warning + deprecated `recommended` field → `preset`). No functional
impact, but `biome migrate` will keep producing warnings until bumped.

**Assessment**: trivial cleanup, bundle with the next biome-touching change.
