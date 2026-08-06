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
import { ApiError, AuthError } from '../cli/errors.js'
import { buildMeasurementMap, transformLogs } from '../transform/workouts.js'
import {
  CACHE_VERSION,
  getCacheFilePath,
  loadCache,
  mergeLogs,
  saveCache,
  type WorkoutCache,
} from './cache.js'

export interface LoadOptions {
  /** Bypass the local cache and do a full history walk + resync. */
  fresh?: boolean
  /** Override the cache file path (tests). */
  cachePath?: string
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
  /** Cache provenance — fromCache=false means a full walk happened this run. */
  cache: { fromCache: boolean; syncedAt?: string; finalized?: boolean }
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

  const [{ logs, cache }, userResp, globalMeasurements] = await Promise.all([
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
    },
  }
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
): Promise<{ logs: RawLog[]; cache: WorkoutCache | null }> {
  const cachePath = opts.cachePath ?? getCacheFilePath()
  let cached: WorkoutCache | null = opts.fresh ? null : loadCache(userId, cachePath)

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
    saveCache(
      {
        version: CACHE_VERSION,
        userId,
        syncedAt: new Date().toISOString(),
        continuation,
        finalized: walk.finalized,
        logs,
      },
      cachePath,
    )
  }

  return { logs, cache: cached }
}
