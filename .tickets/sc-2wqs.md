---
id: sc-2wqs
status: closed
deps: []
links: []
created: 2026-08-06T21:04:34Z
type: task
priority: 2
assignee: cc-vps
tags: [config, tests, tech-debt]
---
# config: setEnv() module-level mutable singleton is a test footgun

Configuration-isolation backlog (P2). src/config/config.ts keeps a module-global env via let _env = process.env and setEnv() mutates it (tests + run.ts injection). Vitest runs test files in parallel; any test that calls setEnv() races with other test files reading config. Currently safe only because the config tests reset env in afterEach. This will bite as soon as CLI-level or integration tests exercise config paths.

## Design

Options, in order of preference: (a) thread env explicitly through the code path (per-invocation plumbing, e.g. pass a ConfigEnv into sessionStore/config functions) so no module state exists; (b) keep setEnv but add a resetEnv() helper and a documented rule that every test touching config must reset in afterEach; (c) run config tests serially (vitest --no-file-parallelism or fileParallelism:false in vitest.config.ts). Option (a) is the real fix; (b)/(c) are stopgaps. Note run.ts calls setEnv with the real process.env at bootstrap, so any refactor must preserve that injection point.

## Acceptance Criteria

No module-global env mutation can cause cross-test-file races (or tests are made serial as a documented stopgap). All existing 78 unit tests still pass. run.ts env injection behavior unchanged. Tests for the new approach exist and reset state in afterEach where applicable.

## Notes

**2026-08-07T12:00:00Z**

Shipped in PR (chore/polish-cache-retry-folders-config) — **option (b) stopgap, hardened**. `setEnv` now snapshots its input (later mutation of the passed object cannot leak in) and a new `resetEnv()` restores the real `process.env`; config.test.ts uses `resetEnv()` in `afterEach` and adds two tests pinning the contract (snapshot isolation, reset-to-process.env). The documented rule lives in the config.ts module docstring. Full per-invocation plumbing (option (a)) was deliberately deferred: it would thread an Env through every command/factory call site for a race that Vitest's default per-file module isolation already prevents — the residual risk is intra-file leakage and `--no-file-parallelism`/isolation:false configs, which the reset rule covers. Revisit (a) if CLI-level tests ever exercise config paths heavily. Closed.

