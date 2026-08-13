---
id: sc-ri38
status: closed
deps: []
links: []
created: 2026-08-13T04:13:37Z
type: task
priority: 2
assignee: cc-vps
external-ref: PR #16 live finding
parent: sc-7hhn
tags: [write, api, exercises]
---
# write: tighten exercises create cell-type validation to the server's supported set

Live testing on the disposable account (toshi.collab) discovered the backend rejects custom-exercise creation with unsupported cellTypeConfig combinations: HTTP 400 CELL_TYPE_CONFIGS_NOT_SUPPORTED (e.g. [REPS, BARBELL_WEIGHT]). Confirmed-accepted combos: [REPS], [REPS, RPE], [ASSISTED_BODYWEIGHT, REPS, RPE].

Currently strong exercises create --cell-type accepts a broad set (REPS, RPE, OTHER_WEIGHT, BARBELL_WEIGHT, DUMBBELL_WEIGHT, WEIGHTED_BODYWEIGHT, PLATE_WEIGHT, DISTANCE, DURATION, REST_TIMER, NOTE), so a user can create an exercise the server will refuse with a 400 (surfaced as an opaque write failure rather than a clean UsageError).

Work: probe the server for the exact supported set (create + archive throwaway defs on the disposable account), tighten the CLI validation + docs (README, api-inventory.md) to match, and fail fast with a clean UsageError before PUTting.

## Acceptance Criteria

exercises create with a server-unsupported cellTypeConfig combo fails fast with a UsageError before any PUT; supported set documented in README + api-inventory.md; all unit + live tests green.


## Notes

**2026-08-13T04:55:45Z**

Implemented: tightened exercises create --cell-type validation to the server's exact accepted set. Probed live on the disposable account (toshi.collab): the backend accepts only 9 ORDERED signatures — REPS; REPS,RPE; DURATION; DISTANCE,DURATION; and <weight>,REPS,RPE for weight in {OTHER_WEIGHT, BARBELL_WEIGHT, DUMBBELL_WEIGHT, WEIGHTED_BODYWEIGHT, ASSISTED_BODYWEIGHT}. Order is significant (RPE,REPS rejected); mandatory/isExponent flags do not affect acceptance. PLATE_WEIGHT fails entity parsing (INVALID_DATA) and appears in no public-library exercise; REST_TIMER/NOTE are rejected in custom defs. CLI now fails fast with a clean UsageError before any PUT (src/commands/exercises.ts: EXERCISE_CELL_TYPES narrowed + EXERCISE_CELL_TYPE_SIGNATURES allowlist; ASSISTED_BODYWEIGHT added — it was missing but is accepted). Docs updated (README supported-combos table, docs/api-inventory.md gotcha). Tests: 4 new unit tests (combo/order/app-only rejection, weight-first + cardio/machine acceptance); new live regression test asserting all 9 signatures are accepted (create+archive, no resync). Unit (230) + live (8) + verify all green.
