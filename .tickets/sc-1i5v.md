---
id: sc-1i5v
status: closed
deps: []
links: []
created: 2026-09-10T00:33:31Z
type: feature
priority: 1
assignee: cc-vps
tags: [phase-1, performance, api-safety, export]
---
# Add date-filtered enriched workout export for bulk consumers

Bulk consumers currently have to list workout summaries and then invoke the single-workout command once per result to obtain exercises and sets. Each detail invocation independently downloads the user measurement document and the paginated public global exercise library. The list/export data loader already synchronizes complete raw logs, resolves metadata once, and constructs detailed Workout objects, so expose a bounded machine-readable bulk contract instead of requiring an N+1 command pattern. This reduces request volume and soft-rate-limit exposure for any automation consuming multiple workouts.

## Design

Extend the existing export path with a --since <date-or-ISO> filter (or an equivalently small, documented bulk-read interface). Apply the filter locally to transformed workouts by startDate after the normal incremental cache sync. Preserve the existing enriched workout shape, including resolved exercise names, sets, canonical values, account display-unit metadata, and source IDs. Do not add per-workout detail requests, do not imply --fresh, and keep stdout valid machine JSON. Document that --since limits emitted workouts rather than the server-side sync cursor.

## Acceptance Criteria

- A documented command emits enriched workouts on/after a valid date or ISO instant, with exercise names and complete set data.
- Invalid --since values fail with a clear usage error.
- The command performs one shared data load and makes zero /logs/{id} detail calls regardless of workout count.
- Mock-fetch regression coverage compares small and large workout sets and proves request count is independent of emitted workout count (aside from actual pagination pages).
- JSON includes the unit metadata needed to interpret canonical workout values and remains clean on stdout.
- Empty ranges return a valid document with zero workouts.
- README/help text describes filtering, cache behavior, and that --fresh remains opt-in.
- Build, unit tests, lint, package test, and typecheck pass.

