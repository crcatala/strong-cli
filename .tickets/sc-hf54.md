---
id: sc-hf54
status: in_progress
deps: [sc-m3xf]
links: []
created: 2026-08-13T00:16:39Z
type: task
priority: 3
assignee: cc-vps
parent: sc-7hhn
tags: [write, api, measurements]
---
# write + read: body measurements - list / log / delete (serverConfirmed)

Fill the biggest surface gap - we currently have NO measurements command at all even though StrongClient.getUserMeasurements exists. Add:

- Read: strong measurements [--type] - list body measurements (fills the read gap first; cheap).
- Log: strong measurements add <type> <value> - buildMeasuredValue; WEIGHT takes display unit, BODY_FAT_PERCENTAGE whole %, CALORIC_INTAKE kcal; unknown type -> clean error.
- Delete: strong measurements delete <id> - soft-delete measuredValue. This is the second INFERRED shape (never captured): apply flat softDelete and re-sync to verify, reporting serverConfirmed true | false | undefined. Keep the verify loop.

## Design

strong-mcp refs (MIT): src/write/entity-builders.ts (buildMeasuredValue - type whitelist, throws on unknown), src/write/soft-delete.ts, src/services/write-service.ts (logMeasurement, deleteMeasurement + safeResync).

Our refs: src/api/client.ts (getUserMeasurements, userMeasurementsUrl in src/api/endpoints.ts), src/api/types.ts (MeasurementsResponse), docs/api-inventory.md.

CLI shape: strong measurements [--type <T>] | strong measurements add <type> <value> | strong measurements delete <id>. Follow existing command patterns; measuredValue entities carry id, type, value, isHidden, created/lastChanged, _links.user.

## Acceptance Criteria

List shows existing measurements (read gap closed). Add creates one visible via list and on the disposable account in the app/strong-mcp. Delete soft-hides it with serverConfirmed === true. Unknown type -> clean UsageError. Live test on disposable account: add -> verify -> delete -> verify.


## Notes

**2026-08-13T13:21:12Z**

Implemented measurements list/add/delete CLI, measuredValue builder/service, unit conversion, inferred delete verification, docs, and unit tests. Live disposable-account verification was not run because STRONG_DISPOSABLE_USER_ID/RUN_LIVE_WRITE_TESTS are not configured.
