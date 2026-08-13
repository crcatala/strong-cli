---
id: sc-ri38
status: open
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

