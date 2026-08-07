# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
