/**
 * Write-layer domain types for the Strong envelope-PUT protocol.
 *
 * The backend exposes writes as a whole-document sync: PUT /api/users/{userId}
 * with an envelope that embeds ONLY the changed entities, keyed by collection
 * (see docs/api-inventory.md and jerhinesmith/strong-mcp, MIT). This module
 * defines the collection set, the entity/snapshot model the write engine
 * operates on, and the envelope shape.
 */

export const COLLECTIONS = [
  'template',
  'log',
  'measurement',
  'widget',
  'tag',
  'folder',
  'metric',
  'measuredValue',
] as const

export type CollectionName = (typeof COLLECTIONS)[number]

export interface Entity {
  id: string
  isHidden?: boolean
  [key: string]: unknown
}

export type EntityMap = Record<string, Entity>

export interface Snapshot {
  userId: string
  /** Continuation token to resume the next walk from (null/'' = first page). */
  continuation: string | null
  /** ISO timestamp of the last successful sync. */
  syncedAt: string | null
  /** Account preferences from the user doc (weightUnit/distanceUnit, …). */
  preferences: Record<string, unknown>
  /** Merged entities by collection, indexed by id (idempotent replace-by-id). */
  entities: Record<CollectionName, EntityMap>
}

/** One changed entity destined for the envelope (see {@link buildEnvelope}). */
export interface Change {
  collection: CollectionName
  entity: Entity
}

/** Body of the envelope PUT (all collections present, unchanged ones empty). */
export interface WriteEnvelope {
  id: string
  strongAnalytics: false
  _embedded: Record<CollectionName, Entity[]>
}
