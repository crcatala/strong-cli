/**
 * Shared parsing for write-command set/exercise specs.
 *
 * Used by `strong templates create` and `strong workout log`:
 * - `--exercise <id>:<sets>` — one exercise + comma-separated set specs
 * - set spec `reps[@weight][~rpe]` — weight in display units (converted to
 *   canonical kg on the wire by the write layer), RPE allows half-steps (8.5)
 *   like the read path.
 */

import { UsageError } from '../cli/errors.js'
import type { ExerciseInput, SetInput } from '../write/log-builder.js'

/**
 * Parse a single set spec `reps[@weight][~rpe]` (weight in display units,
 * converted to kg on the wire). e.g. `10`, `10@60`, `8@60~8`.
 */
export function parseSetSpec(spec: string): SetInput {
  // reps[@weight][~rpe]; RPE allows half-steps (8.5) like the read path.
  const m = /^(\d+)(?:@([\d.]+))?(?:~([\d.]+))?$/.exec(spec.trim())
  if (!m) {
    throw new UsageError(
      `Invalid set spec "${spec}" — expected reps[@weight][~rpe], e.g. 10@60 or 8@60~8.5`,
    )
  }
  const reps = Number.parseInt(m[1], 10)
  const weight = m[2] !== undefined ? Number.parseFloat(m[2]) : 0
  const rpe = m[3] !== undefined ? Number.parseFloat(m[3]) : undefined
  if (!Number.isFinite(reps) || reps <= 0) {
    throw new UsageError(`Invalid reps in set spec "${spec}"`)
  }
  if (!Number.isFinite(weight) || weight < 0) {
    throw new UsageError(`Invalid weight in set spec "${spec}"`)
  }
  if (rpe !== undefined && (!Number.isFinite(rpe) || rpe <= 0)) {
    throw new UsageError(`Invalid RPE in set spec "${spec}"`)
  }
  return { reps, weight, rpe }
}

/** Parse an `--exercise <id>:<sets>` spec, e.g. `ex-1:10@60,8@70`. */
export function parseExerciseSpec(spec: string): ExerciseInput {
  const idx = spec.indexOf(':')
  if (idx <= 0) {
    throw new UsageError(
      `Invalid --exercise "${spec}" — expected <exercise-id>:<sets>, e.g. ex-1:10@60,8@70`,
    )
  }
  const exerciseId = spec.slice(0, idx).trim()
  const sets = spec
    .slice(idx + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseSetSpec)
  if (sets.length === 0) {
    throw new UsageError(`--exercise "${spec}" must list at least one set`)
  }
  return { exerciseId, sets }
}

/** Commander collector for repeatable `--exercise` flags. */
export function collectExercise(value: string, previous: string[]): string[] {
  return [...previous, value]
}
