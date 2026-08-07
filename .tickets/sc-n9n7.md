---
id: sc-n9n7
status: closed
deps: []
links: []
created: 2026-08-07T20:11:33Z
type: feature
priority: 3
assignee: cc-vps
tags: [features, cli, api]
---
# add tag filter flag to workouts, stats and export

## Design

Filter workouts to those containing at least one exercise carrying a tag. Tags ship complete _links.measurement lists from the user doc (include=tag, verified live: 10 tags, same user-scoped href shape as workout cell-set-groups so ids match Exercise.id directly). Match case-insensitive on tag display name or slug id; UsageError on zero (list available) or ambiguous matches. Tag fetch is one small page per run; export records filter.tag in the export doc.

## Acceptance Criteria

strong workouts/stats/export --tag <name> filters to workouts with tagged exercises; help text documents the flag; unknown tag is a usage error listing available tags; unit + CLI tests; all existing tests pass


## Notes

**2026-08-07T20:11:52Z**

Shipped in PR (chore/tag-filter-and-jwt-docs) — --tag <name> (-t) on workouts/stats/export filters to workouts containing at least one tagged exercise. Verified live against the real account (2026-08-07): tags ship complete _links.measurement lists from include=tag (10 tags, 23-76 exercises each); links are user-scoped /api/users/{userId}/measurements/{id} hrefs — the same shape as workout cell-set-group links, so parsed ids compare directly against Exercise.id. Matching is case-insensitive against tag display name or slug id; UsageError on zero matches (lists available tags), ambiguous matches, or tags with no linked exercises. resolveTaggedMeasurementIds() in lib/data.ts fetches tags (one small page) after loadWorkoutData; pure helpers tagMeasurementIds()/workoutHasAnyTaggedExercise() in transform/workouts.ts (shared idFromHref with measurementIdFromGroup). export --tag records filter.tag in the export doc so filtered exports are self-describing; totals reflect the filtered set. Tests: transform (id parsing, predicate), data (resolver match/error paths), commands (CLI filter, stats totals, export doc). Closed.
