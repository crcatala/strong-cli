# Strong CLI — Design & Plan

A read-only TypeScript CLI for [Strong Workout Tracker](https://www.strong.app/), built
from the reverse-engineered API at `https://back.strong.app`.

## Motivation

Strong.app has no official public API. Personal productivity setup needs CLI access to
workout data (history, volumes, exercise library). Prior art exists but none is a
maintained npm TypeScript library, so we home-roll a thin client using the reverse
engineered API surface confirmed by several independent OSS implementations.

## Reference implementations (triangulated)

| Repo | Lang | Use |
|---|---|---|
| [tolik518/strong-api-workout-sync](https://github.com/tolik518/strong-api-workout-sync) | Rust | Current REST backend endpoints + real fixtures (2026-03) |
| [jerhinesmith/strong-mcp](https://github.com/jerhinesmith/strong-mcp) | TS (MIT) | Token lifecycle (JWT decode, proactive refresh, single-flight), write envelope protocol |
| [TheAlexLichter/strong-exporter](https://github.com/TheAlexLichter/strong-exporter) | TS | Cell parsing + continuation pagination |
| [pratyaksh123/strong-api](https://github.com/pratyaksh123/strong-api) | Python | Read/write basics |
| [ivanvmoreno/strong-skill](https://github.com/ivanvmoreno/strong-skill) | Python | Read endpoint map incl. templates/folders/tags |

License note: `strong-mcp` (MIT) patterns were adapted; `strong-api-workout-sync` has
**no license** so nothing was copied from it — only API knowledge, which is not
copyrightable.

## Architecture

```
src/
  cli.ts            # thin entrypoint (deps injected from process)
  cli-main.ts       # error handling, EPIPE/SIGINT, JSON errors
  run.ts            # commander bootstrap, env + fetch injection
  cli/
    context.ts      # output format + color resolution
    errors.ts       # CliError / UsageError / AuthError / ApiError
    output.ts       # json/plain/table/quiet output helpers
    program.ts      # command registration + help
  config/config.ts  # session storage: env → keyring → config file
  api/
    endpoints.ts    # path builders + default client fingerprint headers
    types.ts        # HAL response types + domain model
    jwt.ts          # access-token JWT decode (exp + nameidentifier)
    token-manager.ts# proactive refresh, single-flight, rotation, persist-first
    client.ts       # HTTP client: auth, 401-retry-after-refresh, 5xx backoff
    factory.ts      # env-wired client construction
  lib/data.ts       # loadWorkoutData(): logs + measurements → domain model
  lib/cache.ts      # per-user JSON cache + continuation cursor (incremental sync)
  transform/workouts.ts  # RawLog → Workout/Exercise/Set + stats helpers
  commands/         # auth, workouts, workout, exercises, stats, export
docs/               # reverse-engineered API documentation
captures/           # fixtures (public + synthetic, no real user data)
tests/
  unit/             # msw-free fetch-mock unit tests (78 tests)
  live/             # gated by RUN_LIVE_TESTS=1 (public+auth paths verified live)
```

## Key decisions

1. **Backend**: `https://back.strong.app` — the current Strong REST API (verified live:
   public `/api/measurements` returns 253 exercises). Not the old Parse backend
   (`ws13.strongapp.co`) used by `dmzoneill/strongapp-api`, which is abandoned and
   account-termination-risky.
2. **Auth**: JWT access token (≈20 min) + rotating refresh token; proactive refresh at
   60s-before-expiry; single in-flight refresh; persist-before-return.
3. **Session storage**: keyring by default (keytar), plaintext config file via
   `--use-config`, env vars (`STRONG_ACCESS_TOKEN`/`STRONG_REFRESH_TOKEN`) for CI.
4. **No writes** in this tool — Strong API writes are undocumented and risky; read-only
   keeps the account safe (DMCA/ToS caution from prior community history).
5. **Incremental sync via continuation cursor** (new): the API pages logs in
   `lastChanged` (modification) order — verified live (1 828 logs / 75 pages,
   `startDate` scrambled, re-fetch from a stored token is idempotent). The CLI
   caches merged logs + the last cursor to `~/.config/strong-cli/cache.json`
   and resumes from it on later runs, so repeat `workouts`/`stats`/`export`
   runs fetch only what changed instead of the full history (75 pages ≈ 10s
   the first time, a few pages after). `--fresh` forces a full re-sync;
   HTTP 400 on a stale cursor triggers an automatic full re-walk.
5. **Client fingerprint**: `User-Agent: Strong Android`, `x-client-build: 600013`,
   `x-client-platform: android` — the combination verified against the live API.
   Overridable via env vars.

## Commands

| Command | Purpose |
|---|---|
| `strong auth login` | Interactive (or env) login, stores session |
| `strong auth status` / `whoami` | Show auth state + token expiry |
| `strong auth refresh` | Force token refresh |
| `strong auth logout` | Clear stored session |
| `strong workouts [--limit --since]` | List workout summaries (paginated) |
| `strong workout <id>` | Full workout detail (sets/weights/RPE) |
| `strong exercises [--search --user]` | Browse the global exercise library (public!) |
| `strong stats [--weeks]` | Volume/sets/weekly aggregation |
| `strong export [-o file]` | JSON export of workouts + exercises |

## Known risks

- Undocumented API: endpoints/build numbers can change — env-var overrides exist.
- Rate limiting observed (repeated bad logins returned `Something went wrong. Please
  try again later.` HTTP 401 — treat as soft block, back off).
- ToS gray zone: keep usage personal + low-frequency. Don't build write features
  without care.

## Future work

- Write API exploration (envelope-PUT sync, per strong-mcp) behind an explicit flag.
- Templates/folders/tags listing.
- ~~Local caching~~ JSON cache + continuation-cursor incremental sync is **done**
  (`src/lib/cache.ts`, wired into `workouts`/`stats`/`export`); SQLite would
  cut cache-file size/IO, and a re-sync-on-delete heuristic (e.g. periodic
  `--fresh` reminder) would close the deleted-workout gap.
- ~~Unit conversions~~ Display conversion is **done** (`src/lib/units.ts`):
  the API stores canonical metric values (weights kg, distances m — verified
  live), the CLI converts to the account's `weightUnit`/`distanceUnit` prefs
  for display (default POUNDS/MILES) and keeps raw values in JSON. Remaining
  nicety: a `--unit` override flag for formatting regardless of prefs.

## Maintenance backlog

Small fixes worth doing when next touching the area (from the pre-standalone
review; low urgency, none blocks everyday use):

- **P2 — `setEnv()` module-level mutable singleton** (`src/config/config.ts`).
  Vitest runs test files in parallel and `setEnv` mutates a module-global env.
  Currently safe (only config tests mutate it, and they reset in `afterEach`),
  but new CLI-level tests should reset env in `afterEach` too, or switch to
  per-invocation env plumbing / serial test runs if it bites.
- **P3 — JWT claims decoded but never validated.** `decodeJwt` reads
  `exp`/`nameidentifier` without signature verification (by design — token
  comes from our own TLS login) or `exp`-bounds/`iat`/`nbf` sanity checks.
  Accepted threat model for a personal read-only CLI; revisit if the tool is
  ever shared or fed third-party session files.
- **P3 — 5xx retry backoff is hardcoded** (250/500 ms, two retries) and 429
  (soft rate limit) fails through immediately. If soft limits are hit in
  practice, add an env-tunable backoff and treat 429 as retryable.
- **P3 — Biome config drift.** `biome.json` pins `$schema 2.3.11` while the
  installed CLI is 2.5.x; `biome migrate` will clear the warnings.
- **Cache gap — deleted workouts.** The API does not tombstone deletions, so
  `--fresh` is the only way to drop deleted workouts from the cache; a
  periodic `--fresh` reminder or a re-sync-on-delete heuristic would close
  this.