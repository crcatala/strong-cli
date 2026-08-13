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

import type { WeightUnit } from '../lib/units.js'
import { weightToKg } from '../lib/units.js'
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
export const MEASURED_VALUE_TYPES = ['WEIGHT', 'BODY_FAT_PERCENTAGE', 'CALORIC_INTAKE'] as const
export type MeasuredValueType = (typeof MEASURED_VALUE_TYPES)[number]

export interface MeasuredValueInput {
  type: MeasuredValueType
  value: number
  weightUnit: WeightUnit
}

/** Build a body-measurement entity for the user-doc envelope. */
export function buildMeasuredValue(
  input: MeasuredValueInput,
  userId: string,
  deps: { clock: Clock },
): Entity {
  const ts = deps.clock()
  const value = input.type === 'WEIGHT' ? weightToKg(input.value, input.weightUnit) : input.value
  return {
    id: newId(),
    type: input.type,
    value,
    isHidden: false,
    _links: { user: { href: `/api/users/${userId}` } },
    created: ts,
    lastChanged: ts,
  }
}

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
