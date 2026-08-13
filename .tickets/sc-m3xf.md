---
id: sc-m3xf
status: closed
deps: []
links: []
created: 2026-08-13T00:16:39Z
type: task
priority: 1
assignee: cc-vps
parent: sc-7hhn
tags: [write, api]
---
# write: foundation - snapshot model + write engine (envelope PUT)

Port the write core from strong-mcp so every write command shares it. Nothing user-facing yet - this is the substrate.

Deliverables:
- Full 8-collection snapshot refresh (template, log, measurement, widget, tag, folder, metric, measuredValue) using our existing continuation-cursor pagination, generalized from the logs-only walk (src/lib/cache.ts). strong-mcp uses include=... on GET /api/users/{userId} with limit 300 and delta-syncs by lastChanged; our cache already pages logs in lastChanged order - mirror that for all collections.
- WriteEngine (serialized queue: refresh snapshot -> build changes -> PUT envelope -> optimistic local merge -> persist).
- buildEnvelope helper; softDelete (cascading isHidden through cellSetGroup/cellSets/cells); ids (randomUUID) + ISO clock.
- First mutation method on StrongClient: putEnvelope (PUT /api/users/{userId}) wired through the existing token manager, 401-refresh-retry and 5xx backoff.
- lbToKg for display-unit weight input (reverse of our existing kg->display conversion in src/lib/units.ts).

## Design

Port from strong-mcp (MIT): src/write/envelope.ts, src/write/write-engine.ts, src/write/soft-delete.ts, src/write/ids.ts (newId = randomUUID, makeClock -> ISO timestamps). Do NOT copy from tolik518/strong-api-workout-sync (no license) - API knowledge only.

Our refs: src/api/client.ts (add putEnvelope; follow getTemplates' authedRequest pattern), src/api/endpoints.ts (userUrl already builds include= list + continuation param), src/lib/cache.ts (extend to full snapshot + per-collection cursors), src/api/types.ts (HAL _embedded shapes; verify against docs/api-inventory.md include values: log|measurement|tag|template|folder|widget|measuredValue|metric).

Note: this repo has a standing TODO (sc-sfn8) that getTemplates fetches a single page only - the generalized walk this ticket builds should fix that gap too (walkTemplates loop).

Testing policy: unit tests with fetch-mock (see tests/unit/); live-gated tests (RUN_LIVE_TESTS=1, tests/live/) that create + verify + clean up a minimal entity on a DISPOSABLE account only. NEVER the main account (sc-akkf policy).

## Acceptance Criteria

putEnvelope exists on StrongClient and reuses auth/retry machinery. Snapshot refresh walks ALL 8 collections with continuation pagination (fixing the sc-sfn8 single-page gap for templates). WriteEngine serializes writes, refreshes before each write, applies changes idempotently by id, persists the merged snapshot only after a 2xx. softDelete cascade covered by unit tests. All existing read commands and tests unchanged and passing. Live test (disposable account): refresh snapshot -> PUT one minimal envelope -> re-sync shows the change -> cleanup.


## Notes

**2026-08-13T00:29:01Z**

Implemented: src/write/ (types, ids, envelope, soft-delete, snapshot, snapshot-store, sync-engine, write-engine); client gains putEnvelope + generic walkUserPages (walkLogs delegates); getTemplates now paginates via user doc (sc-sfn8 fixed); weightToKg added. 21 new unit tests (158 total pass), lint + build + package smoke green. NOTE: live round-trip test added (tests/live) but NOT executed — requires RUN_LIVE_TESTS=1 with a disposable account; unit suite covers the engine/snapshot/soft-delete behavior.
