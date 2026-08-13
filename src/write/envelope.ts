/**
 * Envelope builder for the Strong write protocol.
 *
 * A write is a PUT to /api/users/{userId} whose body embeds ONLY the changed
 * entities, grouped by collection. Every collection the server knows must be
 * present, with unchanged ones sent as empty arrays (shape verified against
 * jerhinesmith/strong-mcp, MIT).
 */

import {
  type Change,
  COLLECTIONS,
  type CollectionName,
  type Entity,
  type WriteEnvelope,
} from './types.js'

export function buildEnvelope(userId: string, changes: Change[]): WriteEnvelope {
  const embedded = {} as Record<CollectionName, Entity[]>
  for (const collection of COLLECTIONS) embedded[collection] = []
  for (const { collection, entity } of changes) embedded[collection].push(entity)
  return { id: userId, strongAnalytics: false, _embedded: embedded }
}
