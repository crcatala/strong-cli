/**
 * Log/template builder for the write layer.
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/write/log-builder.ts
 * (buildLog). A template (logType TEMPLATE) and a completed workout (logType
 * WORKOUT) share the same cellSetGroup shape: one group per exercise, each
 * with a working cellSet (REPS/RPE/weight cells derived from the exercise
 * definition's cellTypeConfigs) plus a trailing REST_TIMER cellSet. Weights
 * are written canonically in kg (display unit converted via weightToKg).
 *
 * Deviation from strong-mcp: the weight-cell set is broadened to match this
 * repo's transform (src/transform/workouts.ts) so OTHER_WEIGHT / PLATE_WEIGHT
 * exercises (the common machine case) can be templated — strong-mcp's set
 * omitted them and would refuse the most common exercises.
 */

import type { WeightUnit } from '../lib/units.js'
import { weightToKg } from '../lib/units.js'
import { type Clock, newId } from './ids.js'
import type { Entity, Snapshot } from './types.js'

const WEIGHT_CELL_TYPES = new Set([
  'OTHER_WEIGHT',
  'DUMBBELL_WEIGHT',
  'BARBELL_WEIGHT',
  'WEIGHTED_BODYWEIGHT',
  'PLATE_WEIGHT',
])

/** Minimal shape of an exercise definition's cellTypeConfigs (from the snapshot). */
interface CellTypeConfigLike {
  cellType: string
  index?: number
}

export interface SetInput {
  reps: number
  weight: number
  rpe?: number
}

export interface ExerciseInput {
  exerciseId: string
  sets: SetInput[]
}

export interface BuildLogInput {
  name: string
  templateId?: string
  exercises: ExerciseInput[]
}

/** Per-exercise rest timer (seconds) from account prefs, defaulting to 85. */
export function restSeconds(snapshot: Snapshot, exerciseId: string): string {
  const rt = (snapshot.preferences as { restTimer?: Record<string, number> } | undefined)?.restTimer
  const secs = rt?.[exerciseId] ?? rt?.[snapshot.userId] ?? 85
  return String(secs)
}

function toKgString(weightDisplay: number, weightUnit: WeightUnit): string {
  return String(weightToKg(weightDisplay, weightUnit))
}

function cell(cellType: string, value: string | null): Entity {
  return { id: newId(), cellType, value, isHidden: false } as unknown as Entity
}

/**
 * Build a log/template entity for the envelope. `kind` selects the logType
 * and whether cellSets are marked completed (WORKOUT) or not (TEMPLATE).
 * Exercises are resolved by id from the snapshot's measurement collection —
 * an id absent from the snapshot throws (sync or create it first).
 */
export function buildLog(
  kind: 'WORKOUT' | 'TEMPLATE',
  input: BuildLogInput,
  snapshot: Snapshot,
  deps: { clock: Clock; weightUnit: WeightUnit },
): Entity {
  const { clock, weightUnit } = deps
  const ts = clock()
  const userId = snapshot.userId
  const completed = kind === 'WORKOUT'

  const cellSetGroup = input.exercises.map((ex) => {
    const def = snapshot.entities.measurement[ex.exerciseId]
    if (!def) {
      throw new Error(
        `Unknown exercise id "${ex.exerciseId}" (not in snapshot; sync or create it first)`,
      )
    }
    // The archive contract (sc-k14b) says archived definitions must not resolve
    // for new writes, so hidden exercises are rejected here too.
    if (def.isHidden === true) {
      throw new Error(
        `Archived exercise id "${ex.exerciseId}" (hidden/soft-deleted; unarchive it in the app or create a new one)`,
      )
    }
    const configs = (
      Array.isArray(def.cellTypeConfigs) ? (def.cellTypeConfigs as CellTypeConfigLike[]) : []
    )
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

    const cellSets: Entity[] = []
    for (const set of ex.sets) {
      const cells = configs.map((cfg) => {
        if (cfg.cellType === 'REPS') return cell('REPS', String(set.reps))
        if (cfg.cellType === 'RPE')
          return cell('RPE', set.rpe === undefined ? null : String(set.rpe))
        if (WEIGHT_CELL_TYPES.has(cfg.cellType))
          return cell(cfg.cellType, toKgString(set.weight, weightUnit))
        throw new Error(
          `Refusing to write unknown cell type "${cfg.cellType}" for exercise ${ex.exerciseId}`,
        )
      })
      cellSets.push({
        id: newId(),
        cellSetTag: null,
        isCompleted: completed,
        isHidden: false,
        cells,
      } as unknown as Entity)
      // trailing rest timer for this working set
      cellSets.push({
        id: newId(),
        cellSetTag: null,
        isCompleted: completed,
        isHidden: false,
        cells: [cell('REST_TIMER', restSeconds(snapshot, ex.exerciseId))],
      } as unknown as Entity)
    }

    return {
      id: newId(),
      isHidden: false,
      groupIndex: null,
      _links: { measurement: { href: `/api/users/${userId}/measurements/${ex.exerciseId}` } },
      cellSets,
    } as unknown as Entity
  })

  const base: Record<string, unknown> = {
    id: newId(),
    logType: kind,
    name: { custom: input.name },
    isHidden: false,
    isArchived: false,
    access: 'PRIVATE',
    isGlobal: false,
    created: ts,
    lastChanged: ts,
    _links: { user: { href: `/api/users/${userId}` } },
    _embedded: { cellSetGroup },
  }
  if (kind === 'WORKOUT') {
    base.startDate = ts
    base.endDate = ts
    if (input.templateId) {
      ;(base._links as Record<string, unknown>).template = {
        href: `/api/users/${userId}/templates/${input.templateId}`,
      }
    }
  }
  return base as Entity
}
