/**
 * Transforms raw Strong API log documents into the domain model
 * (Workout → Exercise → Set) and computes lightweight statistics.
 *
 * Cell-type knowledge mirrors the official app's schema:
 * - weight cells: BARBELL_WEIGHT, DUMBBELL_WEIGHT, OTHER_WEIGHT,
 *   WEIGHTED_BODYWEIGHT, PLATE_WEIGHT
 * - metric cells: REPS, RPE, DISTANCE, DURATION
 * - non-set cells: REST_TIMER, NOTE (a cell set holding these is skipped)
 */

import type {
  CellSet,
  CellSetGroup,
  Exercise,
  LocalizedName,
  Measurement,
  RawLog,
  Template,
  Workout,
  Set as WorkoutSet,
  WorkoutSummary,
} from '../api/types.js'
import type { WeightUnit } from '../lib/units.js'
import { weightToDisplay } from '../lib/units.js'

const WEIGHT_CELL_TYPES = new Set([
  'OTHER_WEIGHT',
  'DUMBBELL_WEIGHT',
  'BARBELL_WEIGHT',
  'WEIGHTED_BODYWEIGHT',
  'PLATE_WEIGHT',
])

const SKIP_CELL_TYPES = new Set(['REST_TIMER', 'NOTE'])

export function isWorkoutLog(log: RawLog): boolean {
  const type = log.logType
  return type === 'WORKOUT' || type === 'LOG'
}

export function logDisplayName(log: RawLog): string | null {
  if (log.name === null || log.name === undefined) return null
  if (typeof log.name === 'string') return log.name
  const localized = log.name as LocalizedName
  return localized.custom ?? localized.en ?? null
}

export function measurementName(measurement: Measurement): string {
  const name = measurement.name
  if (!name) return measurement.id
  return name.custom ?? name.en ?? measurement.id
}

export function templateName(template: Template): string {
  const name = template.name
  if (!name) return template.id
  if (typeof name === 'string') return name
  return name.custom ?? name.en ?? template.id
}

/**
 * Build an id → name lookup from global + user exercise definitions.
 * Global names are overridable by the user's custom names.
 */
export function buildMeasurementMap(
  globalMeasurements: Measurement[],
  userMeasurements: Measurement[] = [],
): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of globalMeasurements) map.set(m.id, measurementName(m))
  for (const m of userMeasurements) map.set(m.id, measurementName(m))
  return map
}

/** Parse one cell set into a structured set, or null for rest/note rows. */
export function parseCellSet(cellSet: CellSet): WorkoutSet | null {
  const types = cellSet.cells.map((c) => c.cellType)
  if (types.some((t) => SKIP_CELL_TYPES.has(t))) return null

  const cellValue = (cellType: string): string | null => {
    const cell = cellSet.cells.find((c) => c.cellType === cellType)
    return cell?.value ?? null
  }

  const weightRaw = cellSet.cells.find((c) => WEIGHT_CELL_TYPES.has(c.cellType))?.value
  const weight = weightRaw !== undefined && weightRaw !== null ? parseFloat(weightRaw) : null
  const repsRaw = cellValue('REPS')
  const reps = repsRaw ? parseInt(repsRaw, 10) : null
  const rpeRaw = cellValue('RPE')
  const rpe = rpeRaw ? parseFloat(rpeRaw) : null
  const distanceRaw = cellValue('DISTANCE')
  const distance = distanceRaw ? parseFloat(distanceRaw) : null
  const duration = cellValue('DURATION')

  if (weight === null && reps === null && distance === null && duration === null && rpe === null) {
    return null
  }

  return { weight, reps, rpe, distance, duration, types }
}

/** Resolve the exercise id from a cell set group's measurement link. */
export function measurementIdFromGroup(group: CellSetGroup): string | null {
  const href = group._links?.measurement?.href
  if (!href) return null
  const parts = href.split('/')
  return parts[parts.length - 1] || null
}

export function transformLog(log: RawLog, measurementMap: Map<string, string>): Workout {
  const exercises: Exercise[] = []
  for (const group of log._embedded?.cellSetGroup ?? []) {
    const id = measurementIdFromGroup(group) ?? 'unknown'
    // Fall back to the measurement id so unknown exercises stay traceable.
    const name = measurementMap.get(id) ?? id

    const sets: WorkoutSet[] = []
    const skippedSets: WorkoutSet[] = []
    for (const cellSet of group.cellSets ?? []) {
      const parsed = parseCellSet(cellSet)
      if (!parsed) continue
      if (cellSet.isCompleted === false) skippedSets.push(parsed)
      else sets.push(parsed)
    }

    if (sets.length === 0 && skippedSets.length === 0) continue
    exercises.push({ id, name, sets, skippedSets })
  }

  return {
    id: log.id,
    name: logDisplayName(log),
    startDate: log.startDate ?? null,
    endDate: log.endDate ?? null,
    timezoneId: log.timezoneId ?? null,
    logType: log.logType ?? 'WORKOUT',
    exercises,
  }
}

export function transformLogs(logs: RawLog[], measurementMap: Map<string, string>): Workout[] {
  return logs.filter(isWorkoutLog).map((log) => transformLog(log, measurementMap))
}

// ============================================================================
// Statistics helpers
// ============================================================================

export interface SetStats {
  completedSets: number
  skippedSets: number
}

/**
 * Total volume for a set: weight × reps (completed sets only).
 *
 * Raw API weights are always kilograms, so this returns kg·reps regardless
 * of the account's display preference (see `lib/units.ts`). Formatting with
 * `formatVolume` converts to the display unit.
 */
export function setVolume(set: WorkoutSet): number {
  if (set.weight === null || set.reps === null) return 0
  return set.weight * set.reps
}

export function exerciseStats(exercise: Exercise): SetStats {
  return {
    completedSets: exercise.sets.length,
    skippedSets: exercise.skippedSets.length,
  }
}

export function workoutVolume(workout: Workout): number {
  return workout.exercises.reduce(
    (sum, ex) => sum + ex.sets.reduce((s, set) => s + setVolume(set), 0),
    0,
  )
}

export function toSummary(workout: Workout): WorkoutSummary {
  const totalSets = workout.exercises.reduce((acc, ex) => acc + exerciseStats(ex).completedSets, 0)
  const skipped = workout.exercises.reduce((acc, ex) => acc + exerciseStats(ex).skippedSets, 0)
  return {
    id: workout.id,
    name: workout.name,
    date: workout.startDate,
    startDate: workout.startDate,
    endDate: workout.endDate,
    timezoneId: workout.timezoneId,
    exercises: workout.exercises.length,
    completedSets: totalSets,
    skippedSets: skipped,
    volume: workoutVolume(workout),
  }
}

/**
 * Format a volume (kg·reps) for display, converting into the given weight
 * unit first. Volumes stay canonical in `setVolume`/`toSummary`; only the
 * human-readable output converts.
 */
export function formatVolume(volume: number, unit: WeightUnit = 'POUNDS'): string {
  if (volume === 0) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    weightToDisplay(volume, unit),
  )
}
