/** Persistent cache for the public global exercise-definition library. */

import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getConfigDir } from '../config/config.js'
import type { MeasurementsResponse } from './types.js'

export const GLOBAL_MEASUREMENTS_CACHE_VERSION = 1
export const DEFAULT_GLOBAL_MEASUREMENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type GlobalMeasurementsCacheProvenance = 'hit' | 'miss' | 'expired' | 'fresh'

interface GlobalMeasurementsCacheRecord {
  version: number
  backendUrl: string
  fetchedAt: string
  measurements: MeasurementsResponse
}

export function normalizeBackendUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function getGlobalMeasurementsCachePath(baseUrl: string): string {
  const key = createHash('sha256').update(normalizeBackendUrl(baseUrl)).digest('hex')
  return join(getConfigDir(), 'global-measurements', `${key}.json`)
}

export function loadGlobalMeasurementsCache(
  baseUrl: string,
  nowMs: number,
  ttlMs = DEFAULT_GLOBAL_MEASUREMENTS_TTL_MS,
  path = getGlobalMeasurementsCachePath(baseUrl),
): { measurements: MeasurementsResponse; provenance: 'hit' | 'expired' } | null {
  if (!existsSync(path)) return null
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as GlobalMeasurementsCacheRecord
    if (
      cached.version !== GLOBAL_MEASUREMENTS_CACHE_VERSION ||
      cached.backendUrl !== normalizeBackendUrl(baseUrl) ||
      !cached.measurements ||
      !Array.isArray(cached.measurements._embedded?.measurement)
    ) {
      return null
    }
    const fetchedAt = Date.parse(cached.fetchedAt)
    if (Number.isNaN(fetchedAt)) return null
    if (nowMs - fetchedAt >= ttlMs)
      return { measurements: cached.measurements, provenance: 'expired' }
    return { measurements: cached.measurements, provenance: 'hit' }
  } catch {
    return null
  }
}

/** Persist a complete public library atomically. No caller should invoke this for a partial page walk. */
export function saveGlobalMeasurementsCache(
  baseUrl: string,
  measurements: MeasurementsResponse,
  fetchedAt: string,
  path = getGlobalMeasurementsCachePath(baseUrl),
): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const record: GlobalMeasurementsCacheRecord = {
    version: GLOBAL_MEASUREMENTS_CACHE_VERSION,
    backendUrl: normalizeBackendUrl(baseUrl),
    fetchedAt,
    measurements,
  }
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 })
    renameSync(tmp, path)
    try {
      chmodSync(path, 0o600)
    } catch {
      // Best effort on filesystems that reject chmod after rename.
    }
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // Best-effort cleanup; an orphaned temp file is never read as a cache entry.
    }
  }
}
