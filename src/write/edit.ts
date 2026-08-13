/**
 * Edit helpers for write entities.
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/write/edit.ts
 * (editEntityName / editSetCells / verifySetCells). Edits clone the entity,
 * rewrite only the targeted field(s), and bump lastChanged so the server's
 * modification-ordered walk re-delivers it on the next delta sync.
 */

import { type WeightUnit, weightToKg } from '../lib/units.js'
import type { Clock } from './ids.js'
import type { Entity } from './types.js'

/**
 * Cell types that carry a weight value. Must match the write set in
 * log-builder.ts and the read transform (src/transform/workouts.ts) — an
 * edit's `weight` field writes to whichever of these the targeted set
 * contains. Broader than strong-mcp's set so OTHER_WEIGHT / PLATE_WEIGHT
 * (the common machine case) can be edited too.
 */
export const WEIGHT_CELL_TYPES = new Set([
  'OTHER_WEIGHT',
  'DUMBBELL_WEIGHT',
  'BARBELL_WEIGHT',
  'WEIGHTED_BODYWEIGHT',
  'PLATE_WEIGHT',
])

/** Set an entity's display name (`name.custom`) preserving every other field. */
export function editEntityName(entity: Entity, name: string, clock: Clock): Entity {
  const clone = structuredClone(entity) as Record<string, unknown>
  const current = (clone.name ?? {}) as Record<string, unknown>
  clone.name = { ...current, custom: name }
  clone.lastChanged = clock()
  return clone as Entity
}

// ============================================================================
// Set-cell edits (sc-iwa3)
// ============================================================================

/** One targeted cell rewrite inside a logged workout (0-based positions). */
export interface SetEdit {
  groupIndex: number
  /** Index among the WORKING sets only — rest-timer sets are skipped. */
  setIndex: number
  reps?: number
  weight?: number
  rpe?: number
}

type EditField = 'reps' | 'rpe' | 'weight'

interface CellLike {
  cellType?: unknown
  value?: unknown
}

/** A cellSet holding only REST_TIMER cells (rest rows are never edit targets). */
function isRestOnly(cellSet: Entity): boolean {
  const cells = Array.isArray(cellSet.cells) ? (cellSet.cells as CellLike[]) : []
  return cells.length > 0 && cells.every((c) => c.cellType === 'REST_TIMER')
}

/** Resolve the working set an edit targets, throwing on out-of-range indices. */
function targetSet(groups: Entity[], edit: SetEdit): Entity {
  const group = groups[edit.groupIndex]
  if (!group) throw new Error(`group index ${edit.groupIndex} out of range`)
  const workingSets = (Array.isArray(group.cellSets) ? (group.cellSets as Entity[]) : []).filter(
    (cs) => !isRestOnly(cs),
  )
  const target = workingSets[edit.setIndex]
  if (!target) throw new Error(`working set index ${edit.setIndex} out of range`)
  return target
}

/** The kg value we intend to store for a weight edit, honoring the display unit. */
function intendedKg(weight: number, weightUnit: WeightUnit): number {
  return weightToKg(weight, weightUnit)
}

/** Which cellType a given edit field writes to (used to detect "no such cell"). */
function fieldMatches(cellType: unknown, field: EditField): boolean {
  if (field === 'reps') return cellType === 'REPS'
  if (field === 'rpe') return cellType === 'RPE'
  return typeof cellType === 'string' && WEIGHT_CELL_TYPES.has(cellType)
}

/** The fields an edit intends to write, in a stable order. */
function fieldsOf(edit: SetEdit): EditField[] {
  const fields: EditField[] = []
  if (edit.reps !== undefined) fields.push('reps')
  if (edit.rpe !== undefined) fields.push('rpe')
  if (edit.weight !== undefined) fields.push('weight')
  return fields
}

/**
 * Rewrite the targeted cells of a logged workout (INFERRED shape, sc-iwa3).
 *
 * The workout-edit PUT was never captured from app traffic, so the inferred
 * shape re-sends the whole log document with ONLY the targeted cells rewritten;
 * every untouched cell keeps its raw value byte-for-byte. Throws on an
 * out-of-range group/set index or when an edit field has no matching cell in
 * the set — otherwise the PUT would silently change nothing while reporting
 * success. Weights are converted to canonical kg (display unit -> kg).
 */
export function editSetCells(
  entity: Entity,
  edits: SetEdit[],
  deps: { clock: Clock; weightUnit: WeightUnit },
): Entity {
  const clone = structuredClone(entity) as {
    lastChanged?: unknown
    _embedded?: { cellSetGroup?: Entity[] }
  }
  const groups = clone._embedded?.cellSetGroup ?? []

  for (const edit of edits) {
    const target = targetSet(groups, edit)
    const cells = Array.isArray(target.cells) ? (target.cells as CellLike[]) : []
    const fields = fieldsOf(edit)
    if (fields.length === 0) {
      throw new Error(
        `edit at group ${edit.groupIndex}, set ${edit.setIndex} specifies no reps/weight/rpe`,
      )
    }
    // Each specified field must match a cell type in the set — otherwise the
    // PUT would silently change nothing while reporting success.
    for (const field of fields) {
      if (!cells.some((c) => fieldMatches(c.cellType, field))) {
        throw new Error(
          `set at group ${edit.groupIndex}, index ${edit.setIndex} has no ${field.toUpperCase()} cell to edit`,
        )
      }
    }
    for (const cell of cells) {
      if (edit.reps !== undefined && cell.cellType === 'REPS') cell.value = String(edit.reps)
      else if (edit.rpe !== undefined && cell.cellType === 'RPE') cell.value = String(edit.rpe)
      else if (edit.weight !== undefined && fieldMatches(cell.cellType, 'weight')) {
        cell.value = String(intendedKg(edit.weight, deps.weightUnit))
      }
      // any cell not matched above keeps its original raw value verbatim
    }
  }
  clone.lastChanged = deps.clock()
  return clone as Entity
}

/**
 * True iff `entity` (server truth, post-write) reflects every edit. Mirrors
 * editSetCells's navigation and cell rules exactly, so verification cannot
 * drift from the edit. In addition to matching the edited values it asserts
 * the document's structure is unchanged (same group/cellSet/cell counts) —
 * the inferred PUT re-sends the whole log, so collateral corruption of
 * untouched sets is the real risk on this path. Weights compare numerically
 * with an epsilon (kg float storage); reps/rpe compare as strings tolerant of
 * numeric server values. A missing entity, out-of-range index, or missing
 * target cell reads as "not confirmed" rather than throwing.
 */
export function verifySetCells(
  original: Entity | undefined,
  entity: Entity | undefined,
  edits: SetEdit[],
  deps: { weightUnit: WeightUnit },
): boolean {
  if (!entity) return false
  const groups =
    (entity as { _embedded?: { cellSetGroup?: Entity[] } })._embedded?.cellSetGroup ?? []
  // Structural invariance: the edit must not have added/removed groups, sets,
  // or cells relative to what we sent. Guards against a malformed inferred PUT
  // that a real server partially accepts and mangles untouched data.
  if (original && !sameShape(originalGroups(original), groups)) {
    return false
  }
  for (const edit of edits) {
    let target: Entity
    try {
      target = targetSet(groups, edit)
    } catch {
      return false
    }
    const cells = Array.isArray(target.cells) ? (target.cells as CellLike[]) : []
    for (const field of fieldsOf(edit)) {
      const cell = cells.find((c) => fieldMatches(c.cellType, field))
      if (!cell) return false // no matching cell -> cannot be confirmed
      if (field === 'weight') {
        const want = intendedKg(edit.weight as number, deps.weightUnit)
        if (Math.abs(Number(cell.value) - want) >= 1e-6) return false
      } else {
        const want = field === 'reps' ? edit.reps : edit.rpe
        if (String(cell.value) !== String(want)) return false
      }
    }
  }
  return true
}

function originalGroups(original: Entity): Entity[] {
  return (original as { _embedded?: { cellSetGroup?: Entity[] } })._embedded?.cellSetGroup ?? []
}

interface GroupLike {
  cellSets?: unknown
}

interface CellSetLike {
  cells?: unknown
}

/** Same number of groups, and within each, same number of cellSets and cells. */
function sameShape(a: Entity[], b: Entity[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const sa = Array.isArray((a[i] as GroupLike | undefined)?.cellSets)
      ? ((a[i] as GroupLike).cellSets as Entity[])
      : []
    const sb = Array.isArray((b[i] as GroupLike | undefined)?.cellSets)
      ? ((b[i] as GroupLike).cellSets as Entity[])
      : []
    if (sa.length !== sb.length) return false
    for (let j = 0; j < sa.length; j++) {
      if (
        (Array.isArray((sa[j] as CellSetLike | undefined)?.cells)
          ? ((sa[j] as CellSetLike).cells as unknown[]).length
          : 0) !==
        (Array.isArray((sb[j] as CellSetLike | undefined)?.cells)
          ? ((sb[j] as CellSetLike).cells as unknown[]).length
          : 0)
      ) {
        return false
      }
    }
  }
  return true
}
