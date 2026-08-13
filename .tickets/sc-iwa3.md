---
id: sc-iwa3
status: open
deps: [sc-m3xf]
links: []
created: 2026-08-13T00:16:39Z
type: task
priority: 2
assignee: cc-vps
parent: sc-7hhn
tags: [write, api, workouts]
---
# write: workouts - log / delete / edit sets (serverConfirmed)

Add write commands for completed workouts: log a workout (buildLog WORKOUT: startDate/endDate = now, optional templateId link), soft-delete a workout by id, edit sets by position.

updateWorkoutSets is one of the two INFERRED shapes in strong-mcp (never captured from traffic): it re-sends the log document with only the targeted cells rewritten (byte-for-byte preservation of untouched cells) and then re-syncs server truth to confirm, reporting serverConfirmed: true | false | undefined. The verify loop is mandatory, not optional.

## Design

strong-mcp refs (MIT): src/write/log-builder.ts (buildLog WORKOUT + templateId link), src/write/soft-delete.ts, src/write/edit.ts (editSetCells, verifySetCells, targetSet - skips REST_TIMER-only cellSets, WEIGHT_CELL_TYPES set), src/services/write-service.ts (logWorkout, deleteWorkout, updateWorkoutSets + safeResync pattern).

Our refs: src/commands/workout.ts (existing set parsing/display - reuse for the edit UX), src/commands/workouts.ts, src/transform/workouts.ts, src/lib/units.ts (display units -> kg on write via lbToKg).

CLI shape (agent picks, consistent with templates ticket): e.g. strong workout log <name> --exercise <id> --sets ... [--template <id>] | strong workout delete <id> | strong workout edit <id> --set <groupIndex>:<setIndex> --reps N [--weight W] [--rpe R]. Report serverConfirmed in plain + JSON output and document it in help.

## Acceptance Criteria

Logged workout appears via strong workouts and matches the sets entered (display units converted to kg on wire, shown back in display units). Delete hides it from list and cache. Edit changes reps/weight/rpe and reports serverConfirmed === true on the disposable account; bad group/set indices -> clean UsageError. templateId link optional and correct when supplied. Live test on disposable account: log -> edit -> verify -> delete -> verify.

