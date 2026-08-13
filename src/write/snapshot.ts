/**
 * Page-application helper for the snapshot walk (mirrors strong-mcp's
 * sync/normalize.ts): merge one user-doc page's embedded entities into the
 * snapshot by id and capture the account preferences.
 */

import type { UserResponse } from '../api/types.js'
import { COLLECTIONS, type Entity, type Snapshot } from './types.js'

/** Merge one user-doc page into the snapshot (idempotent replace-by-id). */
export function applyPage(snapshot: Snapshot, page: UserResponse): void {
  const embedded = page._embedded ?? {}
  for (const collection of COLLECTIONS) {
    const entities = embedded[collection]
    if (!Array.isArray(entities)) continue
    for (const entity of entities) {
      if (entity && typeof entity.id === 'string') {
        snapshot.entities[collection][entity.id] = entity as Entity
      }
    }
  }
  if (page.preferences && typeof page.preferences === 'object') {
    snapshot.preferences = page.preferences
  }
}
