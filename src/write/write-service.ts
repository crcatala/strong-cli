/**
 * Write services for custom exercise definitions (sc-k14b), routine templates
 * (sc-ho9c), and completed workouts (sc-iwa3).
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/services/write-service.ts.
 * Each op builds its changes inside the serialized write engine: refresh
 * (delta sync) -> build -> PUT -> optimistic merge -> persist. The exercise /
 * template / log / delete shapes were captured from real app traffic, so no
 * post-write serverConfirmed verify loop is needed for them; updateWorkoutSets
 * is INFERRED and runs the verify loop (see WorkoutWriteService).
 */

import { resolveWeightUnit, type WeightUnit } from '../lib/units.js'
import { editEntityName, editSetCells, type SetEdit, verifySetCells } from './edit.js'
import {
  buildExerciseDefinition,
  buildMeasuredValue,
  type CellTypeConfig,
  type MeasuredValueType,
} from './entity-builders.js'
import {
  addTemplateToFolder,
  defaultFolder,
  findFolderContaining,
  removeTemplateFromFolder,
} from './folders.js'
import type { Clock } from './ids.js'
import { type BuildLogInput, buildLog } from './log-builder.js'
import { softDelete } from './soft-delete.js'
import type { Change, CollectionName, Entity, Snapshot } from './types.js'
import type { WriteEngine } from './write-engine.js'

/** Raised when a write references an id absent from (or hidden in) the snapshot. */
export class EntityNotFoundError extends Error {
  constructor(
    public readonly collection: string,
    public readonly id: string,
  ) {
    super(`No ${collection} with id "${id}" in the current snapshot`)
    this.name = 'EntityNotFoundError'
  }
}

export interface MeasuredValueWriteServiceOptions {
  engine: WriteEngine
  clock: Clock
  userId: string
  resync: () => Promise<Snapshot>
  reconcile?: (fresh: Snapshot) => Promise<void> | void
}

/** Write service for body measurements. Deletes are inferred and verified. */
export class MeasuredValueWriteService {
  constructor(private readonly opts: MeasuredValueWriteServiceOptions) {}

  logMeasurement(
    type: MeasuredValueType,
    value: number,
  ): Promise<{ id: string; type: string; value: number }> {
    return this.opts.engine.write((snapshot) => {
      const entity = buildMeasuredValue(
        { type, value, weightUnit: weightUnitOf(snapshot) },
        this.opts.userId,
        { clock: this.opts.clock },
      )
      return {
        changes: [{ collection: 'measuredValue', entity }],
        summary: { id: entity.id, type, value },
      }
    })
  }

  async deleteMeasurement(id: string): Promise<{ id: string; serverConfirmed?: boolean }> {
    const summary = await this.opts.engine.write((snapshot) => {
      const measuredValue = requireVisible(snapshot, 'measuredValue', id)
      return {
        changes: [
          { collection: 'measuredValue', entity: softDelete(measuredValue, this.opts.clock) },
        ],
        summary: { id },
      }
    })
    const serverConfirmed = await this.opts.engine.exclusive(async () => {
      const fresh = await this.safeResync()
      if (!fresh) return undefined
      const confirmed = fresh.entities.measuredValue[id]?.isHidden === true
      if (!confirmed && this.opts.reconcile) await this.opts.reconcile(fresh)
      return confirmed
    })
    return { ...summary, serverConfirmed }
  }

  private async safeResync(): Promise<Snapshot | null> {
    try {
      return await this.opts.resync()
    } catch {
      return null
    }
  }
}

export interface ExerciseWriteServiceOptions {
  engine: WriteEngine
  clock: Clock
  userId: string
}

export interface CreateExerciseInput {
  name: string
  cellTypeConfigs: CellTypeConfig[]
  notes?: string
  tagIds?: string[]
}

function requireVisible(snapshot: Snapshot, collection: CollectionName, id: string): Entity {
  const e = snapshot.entities[collection][id]
  if (!e || e.isHidden === true) throw new EntityNotFoundError(collection, id)
  return e
}

export class ExerciseWriteService {
  constructor(private readonly opts: ExerciseWriteServiceOptions) {}

  /** Create a custom exercise definition. */
  createExercise(input: CreateExerciseInput): Promise<{ id: string; name: string }> {
    return this.opts.engine.write(() => {
      const m = buildExerciseDefinition(input, this.opts.userId, { clock: this.opts.clock })
      return {
        changes: [{ collection: 'measurement', entity: m }],
        summary: { id: m.id, name: input.name },
      }
    })
  }

  /** Rename a custom exercise definition (`name.custom`). */
  updateExerciseName(id: string, name: string): Promise<{ id: string }> {
    return this.opts.engine.write((snapshot) => {
      const m = requireVisible(snapshot, 'measurement', id)
      return {
        changes: [{ collection: 'measurement', entity: editEntityName(m, name, this.opts.clock) }],
        summary: { id },
      }
    })
  }

  /** Archive (soft-delete) a custom exercise definition. */
  archiveExercise(id: string): Promise<{ id: string; archived: true }> {
    return this.opts.engine.write((snapshot) => {
      const m = requireVisible(snapshot, 'measurement', id)
      return {
        changes: [{ collection: 'measurement', entity: softDelete(m, this.opts.clock) }],
        summary: { id, archived: true as const },
      }
    })
  }
}

// ============================================================================
// Template write service (sc-ho9c)
// ============================================================================

/** Resolve the account's weight unit from the snapshot preferences. */
function weightUnitOf(snapshot: Snapshot): WeightUnit {
  const prefs = snapshot.preferences as { weightUnit?: Record<string, string> } | undefined
  return resolveWeightUnit(prefs?.weightUnit?.[snapshot.userId])
}

export interface TemplateWriteServiceOptions {
  engine: WriteEngine
  clock: Clock
  userId: string
}

export interface CreateTemplateInput extends BuildLogInput {
  /** Folder to create the template in; defaults to the "My Templates" folder. */
  folderId?: string
}

/**
 * Write service for routine templates (sc-ho9c).
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/services/write-service.ts
 * (createTemplate / updateTemplateName / deleteTemplate). Create builds a
 * TEMPLATE log and links it into a folder (`_links.template`); delete soft-
 * deletes the template and unlinks it from its folder. All three shapes were
 * captured from real app traffic, so no post-write serverConfirmed verify
 * loop is needed here.
 */
export class TemplateWriteService {
  constructor(private readonly opts: TemplateWriteServiceOptions) {}

  /** Create a routine template (and link it into a folder). */
  createTemplate(input: CreateTemplateInput): Promise<{ id: string; name: string }> {
    return this.opts.engine.write((snapshot) => {
      const template = buildLog('TEMPLATE', input, snapshot, {
        clock: this.opts.clock,
        weightUnit: weightUnitOf(snapshot),
      })
      const changes: Change[] = [{ collection: 'template', entity: template }]
      let folder: Entity | undefined
      if (input.folderId) {
        folder = snapshot.entities.folder[input.folderId]
        if (!folder || folder.isHidden === true) {
          throw new EntityNotFoundError('folder', input.folderId)
        }
      } else {
        folder = defaultFolder(snapshot)
      }
      if (folder) {
        changes.push({
          collection: 'folder',
          entity: addTemplateToFolder(folder, this.opts.userId, template.id, this.opts.clock),
        })
      }
      return { changes, summary: { id: template.id, name: input.name } }
    })
  }

  /** Rename a routine template (`name.custom`). */
  updateTemplateName(id: string, name: string): Promise<{ id: string }> {
    return this.opts.engine.write((snapshot) => {
      const t = requireVisible(snapshot, 'template', id)
      return {
        changes: [{ collection: 'template', entity: editEntityName(t, name, this.opts.clock) }],
        summary: { id },
      }
    })
  }

  /** Soft-delete a routine template and unlink it from its folder. */
  deleteTemplate(id: string): Promise<{ id: string; deleted: true }> {
    return this.opts.engine.write((snapshot) => {
      const t = requireVisible(snapshot, 'template', id)
      const changes: Change[] = [{ collection: 'template', entity: softDelete(t, this.opts.clock) }]
      const folder = findFolderContaining(snapshot, this.opts.userId, id)
      if (folder) {
        changes.push({
          collection: 'folder',
          entity: removeTemplateFromFolder(folder, this.opts.userId, id, this.opts.clock),
        })
      }
      return { changes, summary: { id, deleted: true as const } }
    })
  }
}

// ============================================================================
// Workout write service (sc-iwa3)
// ============================================================================

export interface WorkoutWriteServiceOptions {
  engine: WriteEngine
  clock: Clock
  userId: string
  /**
   * Full re-sync returning pristine server truth. Used only to verify the
   * INFERRED updateWorkoutSets shape after a 2xx — the engine's optimistic
   * local snapshot cannot confirm the server accepted the edit. Never throws
   * the write; a failed re-sync just leaves serverConfirmed undefined.
   */
  resync: () => Promise<Snapshot>
  /**
   * Persist pristine server truth after an UNCONFIRMED edit. Without this, an
   * edit the server did not reflect would stay in the persisted snapshot and
   * be replayed into later writes (the delta-sync continuation has already
   * advanced past it). Runs on the engine's serialized tail so it cannot race
   * another write. Optional — when omitted, an unconfirmed edit leaves the
   * optimistic snapshot in place (callers should reconcile themselves).
   */
  reconcile?: (fresh: Snapshot) => Promise<void> | void
}

/**
 * Write service for completed workouts (sc-iwa3).
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/services/write-service.ts
 * (logWorkout / deleteWorkout / updateWorkoutSets). logWorkout builds a
 * WORKOUT log via buildLog (captured shape); deleteWorkout soft-deletes with
 * the cascading isHidden shape (captured). updateWorkoutSets is one of two
 * INFERRED shapes: the workout-edit PUT was never captured from traffic, so
 * it re-sends the log document with only the targeted cells rewritten
 * (byte-for-byte preservation of untouched cells) and then re-syncs server
 * truth to confirm, reporting serverConfirmed: true | false | undefined.
 * An unconfirmed edit is reconciled to pristine server truth (when a
 * `reconcile` callback is provided) so the optimistic snapshot cannot replay
 * it into later writes.
 */
export class WorkoutWriteService {
  constructor(private readonly opts: WorkoutWriteServiceOptions) {}

  /** Log a completed workout (startDate/endDate = now; optional templateId link). */
  logWorkout(input: BuildLogInput): Promise<{ id: string; name: string; exercises: number }> {
    return this.opts.engine.write((snapshot) => {
      const log = buildLog('WORKOUT', input, snapshot, {
        clock: this.opts.clock,
        weightUnit: weightUnitOf(snapshot),
      })
      return {
        changes: [{ collection: 'log', entity: log }],
        summary: { id: log.id, name: input.name, exercises: input.exercises.length },
      }
    })
  }

  /** Soft-delete a completed workout (cascading isHidden through cellSetGroup). */
  deleteWorkout(id: string): Promise<{ id: string; deleted: true }> {
    return this.opts.engine.write((snapshot) => {
      const log = requireVisible(snapshot, 'log', id)
      return {
        changes: [{ collection: 'log', entity: softDelete(log, this.opts.clock) }],
        summary: { id, deleted: true as const },
      }
    })
  }

  /**
   * INFERRED write shape: edit sets by position, then re-sync server truth
   * and verify. serverConfirmed distinguishes "landed and verified" from
   * "PUT returned 2xx but server truth doesn't reflect it yet" (local view
   * is optimistic — re-sync or re-edit to reconcile) and from undefined when
   * the confirmation re-sync failed. Bad group/set indices and edits that
   * target a cell type the set lacks throw BEFORE any PUT.
   */
  async updateWorkoutSets(
    id: string,
    edits: SetEdit[],
  ): Promise<{ id: string; serverConfirmed?: boolean }> {
    // Resolve the unit ONCE so the edit we write and the verification we run
    // agree even if the preference changed during the mid-write refresh.
    let weightUnit: WeightUnit = 'POUNDS'
    let sent: Entity | undefined // the document we PUT — baseline for structural verify
    const summary = await this.opts.engine.write((snapshot) => {
      const log = requireVisible(snapshot, 'log', id)
      weightUnit = weightUnitOf(snapshot)
      sent = editSetCells(log, edits, { clock: this.opts.clock, weightUnit })
      return { changes: [{ collection: 'log', entity: sent }], summary: { id } }
    })

    // Verify + reconcile on the serialized tail so no other write interleaves.
    const serverConfirmed = await this.opts.engine.exclusive(async () => {
      const fresh = await this.safeResync()
      if (!fresh) return undefined
      const confirmed = verifySetCells(sent, fresh.entities.log[id], edits, { weightUnit })
      // An unconfirmed edit must not stay in the persisted snapshot, or later
      // writes would build on (and replay) unverified data. Reconcile to the
      // pristine server truth we just fetched.
      if (!confirmed && this.opts.reconcile) {
        await this.opts.reconcile(fresh)
      }
      return confirmed
    })
    return { ...summary, serverConfirmed }
  }

  /** Full re-sync for post-write verification; never throws (see class docs). */
  private async safeResync(): Promise<Snapshot | null> {
    try {
      return await this.opts.resync()
    } catch {
      return null
    }
  }
}
