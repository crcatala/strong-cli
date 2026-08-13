/**
 * Entity builders for the write layer.
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/write/entity-builders.ts
 * (buildExerciseDefinition). The custom-exercise shape was captured from real
 * app traffic (see docs/api-inventory.md): a measurement entity with
 * measurementType EXERCISE, name/instructions as { custom }, per-cell
 * cellTypeConfigs carrying index + mandatory/isExponent, and _links.tag hrefs
 * scoped to the user.
 */

import type { Clock } from './ids.js'
import { newId } from './ids.js'
import type { Entity } from './types.js'

export interface CellTypeConfig {
  cellType: string
  mandatory?: boolean
  isExponent?: boolean
}

export interface ExerciseDefinitionInput {
  name: string
  cellTypeConfigs: CellTypeConfig[]
  notes?: string
  tagIds?: string[]
}

/**
 * Build a custom exercise definition (measurement entity) for the envelope.
 * `userId` scopes the tag hrefs (`/api/users/{userId}/tags/{id}` — global
 * tags use `/api/tags/{id}`; matching strong-mcp, tag ids are passed through
 * without validation).
 */
export function buildExerciseDefinition(
  input: ExerciseDefinitionInput,
  userId: string,
  deps: { clock: Clock },
): Entity {
  const ts = deps.clock()
  return {
    id: newId(),
    measurementType: 'EXERCISE',
    name: { custom: input.name },
    instructions: { custom: input.notes ?? '' },
    notes: null,
    isGlobal: false,
    isHidden: false,
    tools: [],
    cellTypeConfigs: input.cellTypeConfigs.map((c, index) => ({
      cellType: c.cellType,
      mandatory: c.mandatory ?? false,
      isExponent: c.isExponent ?? false,
      index,
    })),
    _links: {
      tag: (input.tagIds ?? []).map((t) => ({ href: `/api/users/${userId}/tags/${t}` })),
    },
    created: ts,
    lastChanged: ts,
  }
}
