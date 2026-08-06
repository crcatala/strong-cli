/**
 * Local workout-log cache with an incremental-sync continuation cursor.
 *
 * The Strong API pages `/api/users/{userId}?include=log` in **lastChanged
 * (modification time) order** — verified live against this account: the bulk
 * of history carries an import timestamp, the recent tail advances with each
 * new workout, and re-fetching from a stored continuation token re-delivers
 * an *identical* page. That makes cursor-resume sync safe and natural:
 *
 *   - first run: walk the full stream, store `continuation` = the last token
 *     the server pointed us to, plus the merged logs;
 *   - later runs: resume from the stored token — the server replays the tail
 *     page and serves whatever was modified since (new workouts AND edits,
 *     since edits bump `lastChanged` and reappear after the cursor);
 *   - merge by id (newest wins), persist only when something actually changed
 *     (the file holds the full per-set history and can be many MB).
 *
 * Limits: deleted workouts are not tombstoned by the API, so the cache can
 * hold a workout the user removed until a full re-sync (`strong … --fresh`,
 * which bypasses the cache and rewrites it). Corrupt or mismatched-user
 * caches are ignored (treated as a cache miss → full walk).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RawLog } from '../api/types.js'
import { getConfigDir } from '../config/config.js'

export const CACHE_FILENAME = 'cache.json'
export const CACHE_VERSION = 1

export interface WorkoutCache {
  version: number
  userId: string
  /** ISO timestamp of the last sync that changed the cache. */
  syncedAt: string
  /** Continuation token to resume the next incremental walk from ('' = first page). */
  continuation: string
  /** True when the last sync reached the end of the stream. */
  finalized: boolean
  logs: RawLog[]
}

export function getCacheFilePath(): string {
  return join(getConfigDir(), CACHE_FILENAME)
}

/**
 * Read the cache for `userId`. Returns `null` (a miss) when the file is
 * missing, corrupt, a different user's, or on a different cache version —
 * callers then fall back to a full walk.
 */
export function loadCache(userId: string, path = getCacheFilePath()): WorkoutCache | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as WorkoutCache
    if (raw.version !== CACHE_VERSION || raw.userId !== userId || !Array.isArray(raw.logs)) {
      return null
    }
    return raw
  } catch {
    return null
  }
}

/** Persist the cache atomically (tmp file + rename, 0600). */
export function saveCache(cache: WorkoutCache, path = getCacheFilePath()): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 })
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    // best effort — some filesystems reject chmod on rename targets
  }
}

/**
 * Merge freshly fetched logs into cached ones by id — newest wins, so
 * re-fetched tail pages (idempotent after a resume) and edited workouts
 * update in place. Fresh logs must be the newer side of the merge.
 *
 * Returns the *same array reference* when nothing changed (a resume that
 * re-delivered identical pages), which lets callers cheaply skip persisting.
 */
export function mergeLogs(existing: RawLog[], fresh: RawLog[]): RawLog[] {
  if (fresh.length === 0) return existing
  let dirty = false
  const byId = new Map<string, RawLog>(existing.map((l) => [l.id, l]))
  for (const log of fresh) {
    const prev = byId.get(log.id)
    if (prev === undefined || JSON.stringify(prev) !== JSON.stringify(log)) {
      byId.set(log.id, log)
      dirty = true
    }
  }
  return dirty ? [...byId.values()] : existing
}
