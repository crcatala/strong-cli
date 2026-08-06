---
id: sc-z0bi
status: open
deps: []
links: []
created: 2026-08-06T21:04:54Z
type: feature
priority: 2
assignee: cc-vps
tags: [units, cli, feature]
---
# feat: --unit override flag for display formatting

PLAN.md Future work (unit conversions are done; this is the remaining nicety). The API stores canonical metric values (kg, m) and the CLI converts to the account weightUnit/distanceUnit prefs for display (src/lib/units.ts, used by src/commands/workouts.ts, workout.ts, stats.ts). Add a --unit flag to format output in a chosen unit regardless of account prefs. JSON output must keep raw canonical values untouched.

## Design

Add a --unit <kg|lb|km|mi|m> option (naming TBD) to the display commands (workouts, workout, stats — decide scope: all three or a subset). Wire it through loadWorkoutData/command paths so it overrides resolveWeightUnit()/resolveDistanceUnit() only for display, never for JSON. Mirror the existing pattern: units resolve once per command, pass the resolved unit into formatVolume/formatters. Check transform/workouts.ts formatVolume signature for where the unit is threaded. CLI help text should document the flag and that JSON is unaffected. Acceptance of flag name and scope may warrant a quick maintainer check.

## Acceptance Criteria

--unit flag exists on the agreed commands, overrides account prefs for display only. JSON output still contains raw metric values. Help text updated. Unit tests cover the override (e.g. --unit kg on a POUNDS-pref account). Existing 78 tests pass.

