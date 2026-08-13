---
id: sc-dlu6
status: closed
deps: []
links: []
created: 2026-08-06T21:04:54Z
type: task
priority: 2
assignee: cc-vps
tags: [cache, data]
---
# cache: deleted workouts persist in cache until --fresh

Cache-deletion gap. src/lib/cache.ts merges logs by id (newest wins) and the Strong API does not tombstone deletions, so a workout removed in the app stays in ~/.config/strong-cli/cache.json and shows up in workouts/stats/export until a full --fresh re-sync. Documented limit in the module docstring.

## Design

Candidate approaches: (a) periodic --fresh reminder (warn in output when the cache is older than N days or N syncs); (b) re-sync-on-delete heuristic (the API has no tombstones, but re-fetching from an older cursor and diffing ids can surface deletions — costs a full walk, so likely only as a periodic/flag-gated check); (c) timestamp-based heuristic: if lastChanged ordering and the cache syncedAt are both known, detect drift. Verify assumptions live with RUN_LIVE_TESTS=1 before committing to an approach. This is a behavior-design decision: consider asking the maintainer which UX (silent, warn, or auto-fix) is preferred.

## Acceptance Criteria

A documented, tested strategy closes the deleted-workout gap: either automatic or a clear user-visible path to drop them. No data-loss risk for existing caches. Unit tests cover the chosen mechanism; live tests where feasible. Existing 78 tests pass.

## Notes

**2026-08-07T12:00:00Z**

Shipped in PR (chore/polish-cache-retry-folders-config) — **Option B (scheduled auto-heal), days-based**: `WorkoutCache.lastFullSyncAt` (optional, backward compatible) records the last full re-walk; `fullResyncDue()` triggers a full re-walk when it is missing (pre-upgrade caches) or `STRONG_FULL_SYNC_INTERVAL_DAYS` (default 30, env-tunable) have elapsed since it. Full re-walks reset the clock; incremental syncs preserve it. The sync-interval trigger is exposed as `WorkoutData.cache.fullResync === 'interval'` and each of `workouts`/`stats`/`export` prints an informational stderr note when it fires (`logInfo`, suppressed by --quiet). The sync-count variant was dropped: days-since-last-full-sync bounds staleness for both frequent and rare CLI use without persisting a counter on every no-op sync (which would defeat the persist-only-on-change cache design). Verified no data-loss risk: a full re-walk rewrites the cache from the source of truth. Tests: cache.ts (fullResyncDue/parseFullSyncIntervalDays), data.test.ts (interval elapsed, upgrade path, clock reset/preserve, fresh provenance). Closed.

