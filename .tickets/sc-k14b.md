---
id: sc-k14b
status: in_progress
deps: [sc-m3xf]
links: []
created: 2026-08-13T00:16:39Z
type: task
priority: 2
assignee: cc-vps
parent: sc-7hhn
tags: [write, api, exercises]
---
# write: custom exercises - create / rename / archive

Add write commands for the user's CUSTOM exercise definitions (measurement collection via GET/PUT /api/users/{id}/measurements|user doc). This is distinct from the existing strong exercises command, which browses the PUBLIC global library (GET /api/measurements?page=N, no auth) - the help text must document the difference.

- Create: buildExerciseDefinition (name, cellTypeConfigs with cellType/mandatory/isExponent, optional notes, optional tagIds).
- Rename: editEntityName (name.custom).
- Archive: soft-delete (isHidden). All captured shapes.

## Design

strong-mcp refs (MIT): src/write/entity-builders.ts (buildExerciseDefinition), src/write/edit.ts (editEntityName), src/write/soft-delete.ts, src/services/write-service.ts (createExercise, updateExerciseName, archiveExercise).

Our refs: src/commands/exercises.ts (existing public-library browse), src/api/client.ts (getUserMeasurements - already exists, currently unused by any command), src/api/types.ts (measurement shapes; docs/api-inventory.md documents cell types seen in the wild: REPS, RPE, DUMBBELL_WEIGHT, BARBELL_WEIGHT, WEIGHTED_BODYWEIGHT, WEIGHT, REST_TIMER).

CLI shape (agent picks, consistent): e.g. strong exercises create <name> --cell-type REPS,... [--notes] [--tag <id>] | rename <id> <name> | archive <id>.

## Acceptance Criteria

Created custom exercise is resolvable by id from the snapshot and usable when creating templates/workouts. Rename updates the name. Archive hides it from reads and it no longer resolves for new writes. Created defs appear under user measurements read. Live test on disposable account: create -> rename -> archive -> verify each step.


## Notes

**2026-08-13T01:10:46Z**

Implemented: strong exercises create|rename|archive with --write opt-in gating (sc-k14b). Ports from strong-mcp (MIT): buildExerciseDefinition (src/write/entity-builders.ts), editEntityName (src/write/edit.ts), ExerciseWriteService (src/write/write-service.ts) wired through the sc-m3xf write engine (delta-sync refresh -> envelope PUT -> optimistic merge -> persist). CLI: exercises.ts restructured to parent list + subcommands; help documents ToS/risk warning + disposable-account policy; README/CHANGELOG/PLAN updated. Tests: 22 new unit tests (builders/edit/service/CLI incl. opt-in gating, cell-type validation, unknown-id errors); live write-flow test (create->rename->archive, verified at each step) gated by RUN_LIVE_WRITE_TESTS=1 + STRONG_DISPOSABLE_USER_ID. lint/build/coverage/package smoke green.
