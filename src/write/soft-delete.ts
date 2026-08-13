/**
 * Soft-delete: the Strong API has no hard delete — entities are flagged
 * `isHidden` plus a bumped `lastChanged`. For workout-shaped entities the flag
 * cascades through every cellSetGroup/cellSet/cell so the workout disappears
 * from the app's views (cascade shape verified against strong-mcp).
 */

import type { Clock } from './ids.js'
import type { Entity } from './types.js'

export function softDelete(entity: Entity, clock: Clock): Entity {
  const clone = structuredClone(entity) as Record<string, unknown>
  clone.isHidden = true
  clone.lastChanged = clock()

  const embedded = clone._embedded as { cellSetGroup?: unknown[] } | undefined
  const groups = Array.isArray(embedded?.cellSetGroup)
    ? (embedded.cellSetGroup as Record<string, unknown>[])
    : []
  for (const group of groups) {
    group.isHidden = true
    const cellSets = Array.isArray(group.cellSets)
      ? (group.cellSets as Record<string, unknown>[])
      : []
    for (const cellSet of cellSets) {
      cellSet.isHidden = true
      const cells = Array.isArray(cellSet.cells) ? (cellSet.cells as Record<string, unknown>[]) : []
      for (const cell of cells) cell.isHidden = true
    }
  }
  return clone as Entity
}
