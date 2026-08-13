/**
 * Edit helpers for write entities.
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/write/edit.ts
 * (editEntityName). The edit clones the entity, rewrites only the targeted
 * field, and bumps lastChanged so the server's modification-ordered walk
 * re-delivers it on the next delta sync.
 */

import type { Clock } from './ids.js'
import type { Entity } from './types.js'

/** Set an entity's display name (`name.custom`) preserving every other field. */
export function editEntityName(entity: Entity, name: string, clock: Clock): Entity {
  const clone = structuredClone(entity) as Record<string, unknown>
  const current = (clone.name ?? {}) as Record<string, unknown>
  clone.name = { ...current, custom: name }
  clone.lastChanged = clock()
  return clone as Entity
}
