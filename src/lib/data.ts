/**
 * Shared data-loading helper for read commands: fetch logs + exercise
 * definitions and build the domain model in one place.
 *
 * Workout logs are served through the local cache (see `cache.ts`) whenever
 * one exists for this user: the server walk resumes from the stored
 * continuation cursor, so repeat runs only fetch what changed since the last
 * sync instead of downloading the full history every time. Pass `fresh: true`
 * (the `--fresh` flag) to bypass the cache and do a full re-sync.
 */

import type { LogsWalk, StrongClient } from '../api/client.js'
import type { Measurement, RawLog, Workout } from '../api/types.js'
import { ApiError, AuthError, UsageError } from '../cli/errors.js'
import { getEnv } from '../config/config.js'
import {
  buildMeasurementMap,
  tagMeasurementIds,
  tagName,
  transformLogs,
} from '../transform/workouts.js'
import {
  CACHE_VERSION,
  fullResyncDue,
  getCacheFilePath,
  loadCache,
  mergeLogs,
  parseFullSyncIntervalDays,
  saveCache,
  type WorkoutCache,
} from './cache.js'

export interface LoadOptions {
  /** Bypass the local cache and do a full history walk + resync. */
  fresh?: boolean
  /** Override the cache file path (tests). */
  cachePath?: string
  /**
   * Days between automatic full re-syncs (deleted-workout prune). Defaults
   * to STRONG_FULL_SYNC_INTERVAL_DAYS (30).
   */
  fullSyncIntervalDays?: number
}

export interface WorkoutData {
  workouts: Workout[]
  measurementMap: Map<string, string>
  globalMeasurements: Measurement[]
  userMeasurements: Measurement[]
  userId: string
  username?: string
  /** Raw preference strings (e.g. 'POUNDS' / 'MILES'), null when absent. */
  weightUnit: string | null
  distanceUnit: string | null
  /**
   * Cache provenance — fromCache=false means a full walk happened this run.
   * `fullResync` says why when it was not the user's explicit --fresh.
   */
  cache: {
    fromCache: boolean
    syncedAt?: string
    finalized?: boolean
    fullResync?: 'fresh' | 'interval' | null
  }
}

export async function loadWorkoutData(
  client: StrongClient,
  opts: LoadOptions = {},
): Promise<WorkoutData> {
  const session = await client.tokenManager.load()
  if (!session) {
    throw new AuthError('Not authenticated — run `strong auth login` first')
  }
  const userId = session.userId

  const [{ logs, cache, fullResync }, userResp, globalMeasurements] = await Promise.all([
    syncWorkoutLogs(client, userId, opts),
    client.getUser(userId, { includes: ['measurement'] }),
    client.getAllMeasurements(),
  ])

  const userMeasurements = userResp._embedded?.measurement ?? []
  const globalList = globalMeasurements._embedded?.measurement ?? []
  const measurementMap = buildMeasurementMap(globalList, userMeasurements)
  const workouts = transformLogs(logs, measurementMap)

  const weightUnit = (userResp.preferences?.weightUnit?.[userId] as string | undefined) ?? null
  const distanceUnit = (userResp.preferences?.distanceUnit?.[userId] as string | undefined) ?? null

  return {
    workouts,
    measurementMap,
    globalMeasurements: globalMeasurements._embedded?.measurement ?? [],
    userMeasurements,
    userId,
    username: session.username ?? userResp.username ?? userResp.email,
    weightUnit,
    distanceUnit,
    cache: {
      fromCache: cache !== null,
      syncedAt: cache?.syncedAt,
      finalized: cache?.finalized,
      fullResync,
    },
  }
}

/**
 * Resolve a `--tag <query>` flag to the set of measurement (exercise) ids it
 * covers, so callers can filter workouts/stats/exports to exercises carrying
 * that tag. Matching is case-insensitive against the tag's display name or
 * its slug id (e.g. `arms` / `ARMS`). Tags are fetched from the user doc
 * (`include=tag`) — a small, single-page collection (verified live: 10 tags).
 *
 * Throws a UsageError when the query matches nothing (listing available tag
 * names) or matches more than one tag (listing the ambiguous matches).
 */
export async function resolveTaggedMeasurementIds(
  client: StrongClient,
  userId: string,
  query: string,
): Promise<Set<string>> {
  const tags = await client.getTags(userId)
  const q = query.toLowerCase()
  const matches = tags.filter((t) => {
    const name = tagName(t).toLowerCase()
    return name === q || (typeof t.id === 'string' && t.id.toLowerCase() === q)
  })

  if (matches.length === 0) {
    const available = tags
      .map((t) => tagName(t))
      .slice(0, 20)
      .join(', ')
    throw new UsageError(
      `Unknown tag: ${query}. Run \`strong tags\` to list tags${available ? ` (available: ${available})` : ''}`,
    )
  }
  if (matches.length > 1) {
    const listed = matches.map((t) => tagName(t)).join(', ')
    throw new UsageError(`Tag "${query}" is ambiguous, matches: ${listed}`)
  }

  const ids = tagMeasurementIds(matches[0])
  if (ids.length === 0) {
    throw new UsageError(`Tag "${query}" has no linked exercises`)
  }
  return new Set(ids)
}

/**
 * Fetch this user's logs through the cache + incremental resume, persisting
 * the updated cursor/merge back. Falls back to a full walk when there is no
 * cache, when `opts.fresh` is set, or when the stored cursor is rejected
 * (HTTP 400 — stale token; mirrors strong-mcp's resync-on-4xx).
 */
async function syncWorkoutLogs(
  client: StrongClient,
  userId: string,
  opts: LoadOptions,
): Promise<{
  logs: RawLog[]
  cache: WorkoutCache | null
  fullResync: 'fresh' | 'interval' | null
}> {
  const cachePath = opts.cachePath ?? getCacheFilePath()
  let cached: WorkoutCache | null = opts.fresh ? null : loadCache(userId, cachePath)

  // Auto-heal: when the cache has no recorded full sync (upgrade path) or the
  // interval since the last one has elapsed, do a full re-walk instead of an
  // incremental resume — the only way to drop deleted workouts (no tombstones).
  const intervalDays =
    opts.fullSyncIntervalDays ??
    parseFullSyncIntervalDays(getEnv()['STRONG_FULL_SYNC_INTERVAL_DAYS'])
  const autoHeal = cached !== null && fullResyncDue(cached, Date.now(), intervalDays)
  if (opts.fresh || autoHeal) cached = null

  let walk: LogsWalk
  try {
    walk = await client.walkLogs(userId, {
      continuation: cached ? cached.continuation : undefined,
    })
  } catch (err) {
    if (cached && err instanceof ApiError && err.statusCode === 400) {
      cached = null
      walk = await client.walkLogs(userId)
    } else {
      throw err
    }
  }

  const logs = mergeLogs(cached?.logs ?? [], walk.logs)
  // lastNextContinuation is '' when the walk never advanced past page 1
  // (single-page history or an exhausted stream). Falling back to the
  // cached cursor is safe here: the `changed` check below gates the
  // persist on `finalized`, which will have flipped to true and triggers
  // a rewrite regardless of what the continuation field holds.
  const continuation = walk.lastNextContinuation || cached?.continuation || ''
  const changed = !cached || logs !== cached.logs || walk.finalized !== cached.finalized

  if (changed) {
    const now = new Date().toISOString()
    saveCache(
      {
        version: CACHE_VERSION,
        userId,
        syncedAt: now,
        // A full walk (fresh/auto-heal/first-ever) resets the auto-heal clock;
        // incremental saves preserve the last full-sync timestamp.
        lastFullSyncAt: !cached || autoHeal ? now : cached.lastFullSyncAt,
        continuation,
        finalized: walk.finalized,
        logs,
      },
      cachePath,
    )
  }

  return { logs, cache: cached, fullResync: opts.fresh ? 'fresh' : autoHeal ? 'interval' : null }
}
