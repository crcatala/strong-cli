---
id: sc-dlu6
status: open
deps: []
links: []
created: 2026-08-06T21:04:54Z
type: task
priority: 2
assignee: cc-vps
tags: [cache, data]
---
# cache: deleted workouts persist in cache until --fresh

PLAN.md Cache gap. src/lib/cache.ts merges logs by id (newest wins) and the Strong API does not tombstone deletions, so a workout removed in the app stays in ~/.config/strong-cli/cache.json and shows up in workouts/stats/export until a full --fresh re-sync. Documented limit in the module docstring.

## Design

Candidate approaches: (a) periodic --fresh reminder (warn in output when the cache is older than N days or N syncs); (b) re-sync-on-delete heuristic (the API has no tombstones, but re-fetching from an older cursor and diffing ids can surface deletions — costs a full walk, so likely only as a periodic/flag-gated check); (c) timestamp-based heuristic: if lastChanged ordering and the cache syncedAt are both known, detect drift. Verify assumptions live with RUN_LIVE_TESTS=1 before committing to an approach. This is a behavior-design decision: consider asking the maintainer which UX (silent, warn, or auto-fix) is preferred.

## Acceptance Criteria

A documented, tested strategy closes the deleted-workout gap: either automatic or a clear user-visible path to drop them. No data-loss risk for existing caches. Unit tests cover the chosen mechanism; live tests where feasible. Existing 78 tests pass.

