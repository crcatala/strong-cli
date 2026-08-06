# Strong API — Data Model

Raw API shapes vs. the normalized domain model used by `strong-cli`.

## Raw (HAL) model

### Log (a workout session)

```
RawLog
├── id                          string (uuid)
├── name                        { en, custom? }  — localized object
├── logType                     "WORKOUT" | "LOG" | note/custom types
├── startDate / endDate         ISO 8601 (UTC Z)
├── timezoneId                  "Europe/Berlin" etc.
└── _embedded.cellSetGroup[]    exercises performed
      ├── _links.measurement.href  → .../measurements/{exerciseId}  (name lookup!)
      └── cellSets[]             one per performed set
            ├── isCompleted     false = logged but skipped
            └── cells[]          typed key/value pairs
                  { cellType: "OTHER_WEIGHT", value: "60" }
                  { cellType: "REPS", value: "12" }
                  { cellType: "RPE", value: "8" }
```

### Cell types seen in the wild

| cellType | Meaning | Used in spike |
|---|---|---|
| `REPS` | repetitions | yes |
| `RPE` | rating of perceived exertion | yes |
| `OTHER_WEIGHT` | machine / generalized weight | yes |
| `BARBELL_WEIGHT` | barbell load | yes |
| `DUMBBELL_WEIGHT` | dumbbell load | yes |
| `WEIGHTED_BODYWEIGHT` | added weight (dips/pull-ups) | yes |
| `PLATE_WEIGHT` | plate math (mentioned in clients) | yes |
| `DISTANCE` | distance (cardio) | yes |
| `DURATION` | time (cardio/timed) | yes |
| `REST_TIMER` | rest row — skip (not a set) | skip |
| `NOTE` | note row — skip | skip |

### Measurement (an exercise definition)

```
Measurement {
  id                                    (uuid)
  name:      { en?, custom? }
  instructions: { en? }
  cellTypeConfigs: [{ cellType, mandatory }]   e.g. [{REPS, true}, {RPE, false}]
  isGlobal, measurementType ("EXERCISE" | ...)
}
```

`/api/measurements?page=N` — global library (public, 253 entries, no auth).
`/api/users/{userId}/measurements` — user's custom definitions.

### User

```
User {
  id, username, email, name
  preferences: { weightUnit: { [userId]: "KILOGRAMS" | "POUNDS" }, distanceUnit, ... }
}
```

## Normalization (`src/transform/workouts.ts`)

```
Workout { id, name, startDate, endDate, timezoneId, logType, exercises[] }
├── Exercise { id, name, sets[], skippedSets[] }
│     └── Set { weight (kg/lb per prefs), reps, rpe, distance, duration, types[] }
```

Rules:

- exercise name comes from the measurement link id → name map (user custom names win).
- unknown measurement ids fall back to the raw id (keeps data traceable).
- `isCompleted === false` sets go to `skippedSets`.
- rest/note rows are dropped; empty exercises dropped.
- volume per set = weight × reps (completed sets only); volume sums across sets.

## Example

Captured (real, public) + synthetic fixtures in `captures/`:

| File | Source | Notes |
|---|---|---|
| `measurements_page1.json` | real, public API | trimmed to 20 of 200 entries |
| `user_response_logs.json` | synthetic | shape-accurate, references real measurement ids |
| `login_response.json` | synthetic | valid-shaped JWT, fake claims |
| `error_response.json` | real 401 shape | RFC 7807 problem+json |