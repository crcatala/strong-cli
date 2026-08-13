# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-08-13

### Fixed

- `strong login` now resolves the username independently of the password and
  falls back to the stored session's username (env -> config -> keyring),
  prompting interactively on a TTY as a final fallback. Previously it required
  `STRONG_USERNAME` whenever `STRONG_PASSWORD` was set and failed with
  "Missing username" even when a session already existed.
  `STRONG_PASSWORD` can now also be supplied on its own alongside an existing
  stored session for headless logins.

## [0.2.0] - 2026-08-13

### Added

- Opt-in write commands for body measurements (sc-hf54):
  `strong measurements add <type> <value> --write` and
  `strong measurements delete <id> --write`. Writes are gated behind the
  explicit `--write` flag (ToS/risk acknowledgment); defaults remain read-only.
  - `add` logs a measurement for `WEIGHT`, `BODY_FAT_PERCENTAGE`, or
    `CALORIC_INTAKE`; `delete` soft-deletes an existing measurement.
  - The parent `strong measurements` list command now accepts a
    `-t, --type <type>` filter to scope results to a single measurement type.

- Opt-in write commands for completed workouts (sc-iwa3):
  `strong workout log <name> --write --exercise <id>:<sets> [--template <id>]`,
  `strong workout delete <id> --write`, and
  `strong workout edit <id> --set <groupIndex>:<setIndex> [--reps N] [--weight W] [--rpe R] --write`.
  Writes are gated behind the explicit `--write` flag (ToS/risk acknowledgment);
  defaults remain read-only.
  - Write-layer ports from strong-mcp (MIT): `logWorkout` / `deleteWorkout`
    (captured shapes; `src/write/write-service.ts`), and `editSetCells` /
    `verifySetCells` (`src/write/edit.ts`). `log` builds a WORKOUT log via the
    existing `buildLog` (startDate/endDate = now, optional template link, weights
    canonical kg). `delete` soft-deletes with the cascading isHidden shape.
  - `workout edit` is one of the two INFERRED write shapes (never captured from
    app traffic): it re-sends the log document with only the targeted cells
    rewritten (untouched cells preserved byte-for-byte) and then re-syncs
    server truth, reporting `serverConfirmed: true | false | undefined` in
    plain and JSON output. An unconfirmed edit is automatically reconciled to
    pristine server truth (serialized on the write engine's tail) so the
    optimistic snapshot cannot replay it into later writes. Bad group/set
    indices or edits targeting a cell type the set lacks fail with a clean
    `UsageError` before any PUT. `--reps` must be a positive integer; `--weight`
    accepts 0 (clearing added load on bodyweight sets), matching set-spec
    logging.
  - Set specs (`reps[@weight][~rpe]`) and `--exercise` parsing extracted to
    `src/commands/set-spec.ts`, shared with `strong templates create`.
  - Weight-cell type set shared between `log-builder.ts` and `edit.ts`
    (`OTHER_WEIGHT`/`PLATE_WEIGHT` machine exercises can be edited too).

- Opt-in write commands for routine templates (sc-ho9c):
  `strong templates create <name> --write --exercise <id>:<sets> [--folder <id>]`,
  `strong templates rename <id> <name> --write`, and
  `strong templates delete <id> --write`. Writes are gated behind the explicit
  `--write` flag (ToS/risk acknowledgment); defaults remain read-only.
  - Write-layer ports from strong-mcp (MIT): `buildLog` (`src/write/log-builder.ts`,
    TEMPLATE kind — cellSetGroup derived from each exercise's `cellTypeConfigs`
    with a trailing REST_TIMER set, weights written canonically in kg) and
    folder bookkeeping (`src/write/folders.ts` — default "My Templates" folder,
    `_links.template` add/remove). `TemplateWriteService`
    (`src/write/write-service.ts`) wires create/rename/delete through the
    serialized snapshot refresh -> envelope PUT -> optimistic merge -> persist
    engine (sc-m3xf foundation). Delete soft-deletes the template and unlinks
    it from its folder.

- Opt-in write commands for custom exercise definitions (sc-k14b):
  `strong exercises create <name> --write --cell-type <types> [--mandatory]
  [--exponent] [--notes] [--tag]`, `strong exercises rename <id> <name> --write`,
  `strong exercises archive <id> --write`. Writes are gated behind the explicit
  `--write` flag (ToS/risk acknowledgment); defaults remain read-only.
  - Write layer ports from strong-mcp (MIT): `buildExerciseDefinition`
    (`src/write/entity-builders.ts`), `editEntityName` (`src/write/edit.ts`),
    and `ExerciseWriteService` (`src/write/write-service.ts`) wired through the
    serialized snapshot refresh -> envelope PUT -> optimistic merge -> persist
    engine (sc-m3xf foundation).

### Changed

- `strong exercises create` now validates `--cell-type` against the exact
  ordered signatures the backend accepts for custom exercise definitions
  (sc-ri38, found via live probes on a disposable account). Any other
  combination — e.g. `REPS,BARBELL_WEIGHT`, reordered `RPE,REPS`, or the
  app-wide-only cell types `PLATE_WEIGHT`/`REST_TIMER`/`NOTE` — fails fast
  with a clean `UsageError` before any PUT instead of surfacing the server's
  opaque HTTP 400 `CELL_TYPE_CONFIGS_NOT_SUPPORTED`. `ASSISTED_BODYWEIGHT`
  was added to the supported set (it was missing but the server accepts it).
  Supported combos documented in `README.md` and `docs/api-inventory.md`.
- The CLI is now published to npm; the README setup uses the `npm install`
  path, with source install demoted to a "Developing from source" section.

### Fixed

- Body measurements listing now reads the server's `measurementTypeValue`
  field (previously read a non-existent `type`), so `WEIGHT` and
  `BODY_FAT_PERCENTAGE` values display with the correct unit conversion and
  rounding instead of falling through to the raw kcal formatting.
- `strong templates list` now paginates via the user document, fixing the
  sc-sfn8 gap where templates beyond the first page were missing.
- `strong templates create` now rejects archived (hidden) exercise definitions
  with a clean "Archived exercise id" `UsageError`, preserving the archive
  contract that archived defs must not resolve for new writes.
- Set specs now accept half-step RPE values (e.g. `8.5`), matching the read
  path which already parses RPE with `parseFloat`.
- `strong templates delete` now unlinks the template from hidden (soft-deleted)
  folders too, not just visible ones.

## [0.1.1] - 2026-08-07

### Added

- Read-only CLI for Strong Workout Tracker with `auth`, `workouts`, `workout`,
  `exercises`, `stats`, and `export` commands.
- `templates`, `folders`, and `tags` listing commands with `--search` and
  `--limit` filtering.
- `--tag` filter on `workouts`, `stats`, and `export` to scope results to
  workouts containing a given tag.
- `--unit` display override for `workouts`, `workout`, and `stats` (kg/lb, with
  distance units on `workout` detail).
- Session storage in the OS keyring (default), a plaintext session file
  (`--use-config`), or `STRONG_*` environment variables for headless/CI use,
  with proactive JWT refresh and single-flight token rotation.
- Incremental JSON cache with continuation-cursor sync, automatic full re-sync
  when stale or after `STRONG_FULL_SYNC_INTERVAL_DAYS` (default 30) without a
  full walk, and a `--fresh` flag to force re-sync.
- `--json`, `--table`, `--quiet`, and `--verbose` output modes.
- Environment-tunable retry policy (`STRONG_MAX_RETRIES`,
  `STRONG_RETRY_BACKOFF_MS`); HTTP 429 rate-limit responses are retried with
  jittered backoff.

### Changed

- `--version` and the startup banner now read the version from `package.json`
  instead of a hardcoded constant.

### Fixed

- `--tag` filtering on `workouts`, `stats`, and `export` now fetches tags in the
  same API call as workout data, removing an extra round-trip and the
  time-of-check/time-of-use race it introduced.
