---
id: sc-b8p5
status: open
deps: [sc-lv6v]
links: []
created: 2026-09-10T00:33:31Z
type: feature
priority: 3
assignee: cc-vps
tags: [phase-3, performance, cache, api-safety]
---
# Cache public global exercise definitions with a simple TTL

The public global exercise library is stable shared metadata but currently requires a paced multi-page download in every CLI process. If post-bulk measurement confirms meaningful remaining cost, add a conservative persistent cache to reduce request volume for workouts, workout detail, stats, and export commands. Keep this optimization isolated from private user documents and workout-log caching.

## Design

Cache only the public global measurement collection. Use a schema-versioned record keyed by normalized backend URL, an explicit fetched-at timestamp, a simple default TTL (provisionally seven days), atomic writes, and corruption-as-miss behavior. --fresh must bypass and replace the cache. Avoid stale-if-error fallback, background refresh, ETag assumptions, or caching user preferences/custom measurements in the first version. Expose hit/miss/expired provenance through verbose output and HTTP statistics without leaking data.

## Acceptance Criteria

- A warm, unexpired cache causes getAllMeasurements consumers to make zero global-measurement HTTP requests.
- A miss or expired entry performs the normal complete paced pagination walk and atomically replaces the cache.
- --fresh bypasses and refreshes the global cache as documented.
- Cache entries are isolated by backend URL and schema version; corrupt/mismatched entries are safe misses.
- User documents, custom measurements, preferences, tokens, and workout data are not stored in this cache.
- Tests cover hit, miss, expiry, corruption, backend isolation, incomplete pagination failure, and atomic replacement.
- HTTP statistics and verbose output accurately report cache provenance.
- Documentation states TTL and freshness semantics.
- Build, unit tests, lint, package test, and typecheck pass.

