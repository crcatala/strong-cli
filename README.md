# strong-cli

Unofficial read-only CLI for [Strong Workout Tracker](https://www.strong.app/), built
for personal-productivity/AI-agent use. Reverse-engineered from the app's backend
(`https://back.strong.app`) — **no official API exists**, so this is built on
community-reverse-engineered endpoints. Use at your own risk.

> ⚠️ **Caution**: This is an unofficial client for an undocumented API. Use it
> read-only, at low frequency, for your own data. See
> [docs/auth-findings.md#risks](docs/auth-findings.md#risks).

## Setup

> Not published to npm yet — install from source until then.

```bash
git clone https://github.com/crcatala/strong-cli
cd strong-cli
npm install

# once published:
# npm install -g @crcatala/strong-cli

# fast dev (bun runs TS natively — ~85 ms startup)
bun src/cli.ts <command>
# or without bun / fallback
npx tsx src/cli.ts <command>

# build + run (fastest: single compiled output, ~70 ms startup)
npm run build
node dist/cli.js <command>
```

**Startup performance**: the *built* CLI and the bun dev path are roughly equivalent
(~70–85 ms to first output). `npx tsx` adds ~400 ms of npm/npx/loader overhead on top,
so use `bun src/cli.ts` (or the built `dist`) for interactive use. Data commands
(`workouts`, `stats`, `export`) are dominated by network round-trips to the Strong
backend regardless of runner.

## Authentication

```bash
# interactive (stored in OS keyring by default)
npx tsx src/cli.ts auth login

# headless/CI: env vars (password never via flags)
export STRONG_USERNAME="your@email.com"
export STRONG_PASSWORD="your-password"
npx tsx src/cli.ts auth login --use-config   # session → ~/.config/strong-cli/session.json
```

Or inject an existing session via env vars (bypasses login):

```bash
export STRONG_ACCESS_TOKEN="..."   # required
export STRONG_REFRESH_TOKEN="..."  # for auto-refresh
```

Sessions auto-refresh before the JWT expires (~20 min lifetime). `--use-config` sessions are read **and** refreshed from the config file on every command — the keyring is never touched, which is what makes them headless-safe (no D-Bus/`$DISPLAY` requirements). Sessions stored in the keyring are mirrored there on refresh.

## Caching

Workout logs are cached per-user in `~/.config/strong-cli/cache.json` (0600,
written atomically). The Strong API pages logs in modification-time order, so
after the first (full) sync the CLI **resumes from the stored continuation
cursor** — later `workouts`/`stats`/`export` runs only fetch what changed
their `--since`/`--limit` filtering happens locally over the cache. Notable
behaviors:

- First run on a large history is slow by design (1 828 logs ≈ 75 paced pages
  ≈ 10s); afterwards it's a couple of pages.
- `--fresh` on `workouts`/`stats`/`export` forces a full re-sync.
- A stale cursor (HTTP 400) triggers an automatic full re-walk.
- Deleted workouts are not tombstoned by the API. To keep the cache honest
  without manual intervention, a **full re-sync runs automatically** every
  `STRONG_FULL_SYNC_INTERVAL_DAYS` (default 30) since the last full walk —
  `--fresh` still forces one immediately. An informational note is printed
  to stderr when the auto re-sync fires.

## Units

The API stores workout values canonically in metric units (weights in kg,
distances in m) regardless of account preferences — verified live against
real data. Display (`--plain`/`--table`, workout detail) converts to the
account's `weightUnit`/`distanceUnit` preferences (defaulting to **lb/mi**
when unknown); JSON output keeps raw canonical values and reports the units
in metadata. Pass `--unit kg|lb|m|km|mi` on `workouts`/`workout`/`stats` to
override the display units regardless of account prefs (JSON is unaffected).
Volume is displayed in weight-unit × reps (e.g. `11,635 lb`).

## Commands

### Auth

```bash
strong auth login              # interactive login (keyring)
strong auth login --use-config # store session in config file
strong auth status             # user, storage source, token expiry
strong auth whoami             # alias
strong auth refresh            # force token refresh
strong auth logout             # clear credentials
```

### Workouts

```bash
strong workouts                 # latest 100 workouts (each row shows the workout ID)
strong workouts --limit 5 --table
strong workouts --since 2026-01-01
strong workouts --tag push      # only workouts with push-tagged exercises
strong workouts --unit kg       # force kg display regardless of account prefs
strong workout <id>             # full detail (copy the ID from `strong workouts`)
strong workout <id> --unit lb   # force lb display in the detail view
```

### Templates, folders & tags (require auth)

```bash
strong templates                    # first 100 routine templates
strong templates --search push      # filter by name
strong templates --table
strong folders                      # template folders
strong folders --search plan
strong tags                         # exercise tags
strong tags --search push
```

Folder/tag entities come from the user document (`include=folder` /
`include=tag`, shapes verified live): folders organize templates, tags label
exercises. Listings show id + name in json/plain/table; `--search`/`--limit`
work like on `templates`.

`--tag <name>` (also `-t`) filters `workouts`/`stats`/`export` to workouts
that contain at least one exercise carrying the tag. Matching is
case-insensitive against the tag name or id; the tag's exercise set comes
from the user document (verified live: tags ship complete `_links.measurement`
lists). `strong export --tag X` also records `"filter": {"tag": "X"}` in the
export document so filtered exports are self-describing.

### Exercise library (public — works without auth)

```bash
strong exercises                     # first 200 global exercises
strong exercises --search squat
strong exercises --user              # + your custom exercises (needs auth)
```

### Stats & export

```bash
strong stats               # all-time totals, weekly volume, top exercises
strong stats --weeks 12
strong stats --tag push    # aggregate only push-tagged workouts
strong stats --unit lb     # force lb display regardless of account prefs
strong export -o strong-export.json  # full JSON export
strong export --tag push   # export only push-tagged workouts
strong export --json | jq .totals
```

## Output modes

| Flag | Behavior |
|---|---|
| *(default)* | Plain text in TTY, JSON when piped |
| `--json` | Structured JSON |
| `--table` | Aligned table |
| `--quiet` | Bare IDs only |
| `--verbose` / `--debug` | Operational progress / diagnostics on stderr |

## Environment variables

| Var | Purpose |
|---|---|
| `STRONG_USERNAME` / `STRONG_USER` | Login identity |
| `STRONG_PASSWORD` | Login password (env only) |
| `STRONG_ACCESS_TOKEN` / `STRONG_REFRESH_TOKEN` | Reuse an existing session |
| `STRONG_BACKEND` | API base URL (default `https://back.strong.app`) |
| `STRONG_CLIENT_BUILD` / `STRONG_CLIENT_PLATFORM` | Client fingerprint overrides |
| `STRONG_MAX_RETRIES` | Retries for transient errors, 5xx + 429 (default 2) |
| `STRONG_RETRY_BACKOFF_MS` | Base retry backoff in ms, jittered per attempt (default 250) |
| `STRONG_FULL_SYNC_INTERVAL_DAYS` | Days between automatic full cache re-syncs (default 30) |
| `STRONG_FORMAT` | Default output format |
| `NO_COLOR` | Disable colors |

## Documentation & sources

- `docs/api-inventory.md` — endpoint map, request/response shapes
- `docs/auth-findings.md` — auth flow, token lifecycle, risks
- `docs/data-model.md` — raw HAL model vs. normalized domain model
- `PLAN.md` — design decisions, architecture, known risks, backlog
- `RELEASING.md` — how to cut and publish a release
- `captures/` — fixtures: public exercise library (real) + synthetic session/logs
- API knowledge triangulated from `tolik518/strong-api-workout-sync`,
  `jerhinesmith/strong-mcp` (MIT), `TheAlexLichter/strong-exporter`,
  `pratyaksh123/strong-api`, `ivanvmoreno/strong-skill`.

## Tests

```bash
npm test                          # 137 unit tests, mocked fetch
RUN_LIVE_TESTS=1 STRONG_USERNAME=... STRONG_PASSWORD=... \
  npm run test:live               # real API (public + your account)
```