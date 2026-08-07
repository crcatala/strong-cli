# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Read-only CLI for Strong Workout Tracker: `auth`, `workouts`, `workout`,
  `exercises`, `templates`, `folders`, `tags`, `stats`, and `export` commands.
- Session storage via OS keyring (default), plaintext config file (`--use-config`),
  or environment variables for headless/CI use, with proactive JWT refresh and
  single-flight token rotation.
- Incremental JSON cache with continuation-cursor sync, automatic full re-sync
  on stale cursors or `STRONG_FULL_SYNC_INTERVAL_DAYS`, and a `--fresh` escape hatch.
- Display unit conversion to account preferences with a `--unit` override flag,
  and `--tag` filtering on `workouts`/`stats`/`export`.
- JSON, plain, table, and quiet output modes with `--json`/`--table`/`--quiet`/`--verbose`.
- Release tooling: release-it with Keep a Changelog, changelog prep/check helpers,
  npm-package smoke test, live-test environment guard, and contributor/security docs.
- CI hardening: SHA-pinned GitHub Actions, Node 22/24 test matrix, package artifact
  smoke test, GitGuardian secret scanning, and a maintainer-only live-tests workflow.

### Changed

- CLI version now reads from `package.json` instead of a hardcoded constant, so
  `--version` and the banner never drift from the published artifact.
