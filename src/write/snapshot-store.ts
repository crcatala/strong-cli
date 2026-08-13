/**
 * Local snapshot store for the write layer.
 *
 * Complements (does not replace) the read-side log cache (src/lib/cache.ts):
 * while the cache tracks logs + the continuation cursor for
 * `workouts`/`stats`/`export`, the snapshot keeps the full 8-collection entity
 * index the write engine needs to resolve cross-links (folders, exercise
 * definitions) and to merge optimistic changes. Same atomic-write discipline
 * as the cache (tmp file + rename, 0600).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfigDir } from '../config/config.js'
import { COLLECTIONS, type CollectionName, type EntityMap, type Snapshot } from './types.js'

export const SNAPSHOT_FILENAME = 'snapshot.json'
export const SNAPSHOT_VERSION = 1

export interface StoredSnapshot extends Snapshot {
  version: number
}

export function getSnapshotFilePath(): string {
  return join(getConfigDir(), SNAPSHOT_FILENAME)
}

/** A pristine, empty snapshot for `userId` (all collections empty). */
export function emptySnapshot(userId: string): Snapshot {
  const entities = {} as Record<CollectionName, EntityMap>
  for (const collection of COLLECTIONS) entities[collection] = {}
  return {
    userId,
    continuation: null,
    syncedAt: null,
    preferences: {},
    entities,
  }
}

/**
 * Read the snapshot for `userId`. Returns `null` (a miss) when the file is
 * missing, corrupt, a different user's, or on a different version — callers
 * then fall back to a full walk.
 */
export function loadSnapshot(userId: string, path = getSnapshotFilePath()): StoredSnapshot | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as StoredSnapshot
    if (raw.version !== SNAPSHOT_VERSION || raw.userId !== userId || !raw.entities) return null
    return raw
  } catch {
    return null
  }
}

/** Persist the snapshot atomically (tmp file + rename, 0600). */
export function saveSnapshot(snapshot: Snapshot, path = getSnapshotFilePath()): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stored: StoredSnapshot = { version: SNAPSHOT_VERSION, ...snapshot }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 })
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // best effort — some filesystems reject chmod on rename targets
  }
}
