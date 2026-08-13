---
id: sc-7hhn
status: open
deps: []
links: []
created: 2026-08-13T00:16:39Z
type: epic
priority: 1
assignee: cc-vps
tags: [write, api]
---
# epic: write API support (envelope-PUT sync, ported from strong-mcp)

Supersedes sc-akkf (2026-08-07 decision: writes declined 'until needs change'). Needs have changed: an inventory of strong-mcp's write surface (11 tools across the log/template/measurement/measuredValue/folder collections) was taken and ALL of it is a gap in this CLI.

Goal: add opt-in write support to the read-only CLI by porting the envelope-PUT protocol from jerhinesmith/strong-mcp (MIT, https://github.com/jerhinesmith/strong-mcp). Same backend as ours (https://back.strong.app, docs/api-inventory.md) - strong-mcp impersonates iOS, we impersonate Android; identical server and entity model.

Scope (children): foundation snapshot+write engine, then templates CRUD, workout writes (log/delete/edit sets), custom-exercise CRUD, body measurements (read+write).

Posture (carried over from the prior future-work plan): writes live behind an explicit opt-in flag/subcommand; defaults remain read-only; every live test runs against a DISPOSABLE test account, NEVER the main account; help text and README document the ToS/risk warning.

## Design

Reference implementation: jerhinesmith/strong-mcp (MIT - patterns may be adapted with attribution). Key files: src/write/envelope.ts (buildEnvelope), src/write/write-engine.ts (WriteEngine: serialized refresh -> build changes -> PUT -> optimistic merge -> persist), src/write/log-builder.ts (buildLog shared by WORKOUT and TEMPLATE kinds), src/write/soft-delete.ts (cascading isHidden - all deletes are soft, no hard delete exists), src/write/edit.ts (editEntityName, editSetCells, verifySetCells), src/write/folders.ts (folder link bookkeeping), src/write/entity-builders.ts (exercise + measurement builders), src/services/write-service.ts (all 11 ops).

Write protocol: PUT /api/users/{userId} with envelope body {id: userId, strongAnalytics: false, _embedded: {<collection>: [changed entities]}}; unchanged collections sent as empty arrays. The client sends a snapshot-derived document with changed entities only.

Provenance: 9 of 11 shapes were captured from real app traffic; 2 are INFERRED (updateWorkoutSets, deleteMeasurement) - strong-mcp never observed those requests, so it applies its best-guess shape and self-verifies via a post-write re-sync, reporting serverConfirmed: true | false | undefined. Ports of those two MUST keep the verify loop.

Our repo already has: continuation-cursor pagination + incremental cache (src/lib/cache.ts), token manager with proactive refresh, 401-refresh-retry + 5xx backoff client, unit display conversion (src/lib/units.ts), read commands for workouts/templates/folders/tags/exercises/stats/export. The write layer slots in beside these; GET-only defaults must not change.

## Acceptance Criteria

All children closed. Write commands exist behind an explicit opt-in flag; default behavior of every existing command is unchanged (all current tests still pass). README + command help document the ToS/risk warning and the disposable-account testing policy. Live tests are gated by RUN_LIVE_TESTS=1 and only touch the disposable account. A decision note records that sc-akkf is superseded.

