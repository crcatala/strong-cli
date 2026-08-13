/**
 * Identifier + timestamp helpers for write entities.
 *
 * Strong entity ids are UUIDs (verified in captured fixtures) and timestamps
 * are ISO-8601 strings the API compares for lastChanged ordering.
 */

import { randomUUID } from 'node:crypto'

/** New entity id — UUIDv4, matching captured fixtures. */
export const newId = (): string => randomUUID()

/** Returns the ISO timestamp a write should stamp on created/lastChanged. */
export type Clock = () => string

/** Clock factory (injectable `now` for tests). */
export function makeClock(now: () => number = Date.now): Clock {
  return () => new Date(now()).toISOString()
}
