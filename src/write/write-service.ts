/**
 * Write service for custom exercise definitions (sc-k14b).
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/services/write-service.ts
 * (createExercise / updateExerciseName / archiveExercise). Each op builds its
 * changes inside the serialized write engine: refresh (delta sync) -> build ->
 * PUT -> optimistic merge -> persist. All three shapes were captured from real
 * app traffic, so no post-write serverConfirmed verify loop is needed here.
 */

import { resolveWeightUnit, type WeightUnit } from '../lib/units.js'
import { editEntityName } from './edit.js'
import { buildExerciseDefinition, type CellTypeConfig } from './entity-builders.js'
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
