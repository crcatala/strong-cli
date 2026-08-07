import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CACHE_VERSION,
  DEFAULT_FULL_SYNC_INTERVAL_DAYS,
  fullResyncDue,
  loadCache,
  mergeLogs,
  parseFullSyncIntervalDays,
  saveCache,
  type WorkoutCache,
} from '../../src/lib/cache.js'
import { syntheticLog } from '../helpers/fixtures.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-cache-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function sampleCache(overrides: Partial<WorkoutCache> = {}): WorkoutCache {
  return {
    version: CACHE_VERSION,
    userId: 'user-1',
    syncedAt: '2026-08-01T00:00:00.000Z',
    continuation: 'TOKEN1',
    finalized: true,
    logs: [syntheticLog({ id: 'log-a' }), syntheticLog({ id: 'log-b' })],
    ...overrides,
  }
}

describe('cache persist/load', () => {
  it('round-trips a cache through the file', () => {
    const path = join(tmp, 'cache.json')
    const cache = sampleCache()
    saveCache(cache, path)
    const loaded = loadCache('user-1', path)
    expect(loaded).toEqual(cache)
  })

  it('writes the cache with 0600 permissions', () => {
    const path = join(tmp, 'cache.json')
    saveCache(sampleCache(), path)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('returns null for a missing file', () => {
    expect(loadCache('user-1', join(tmp, 'nope.json'))).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    const path = join(tmp, 'cache.json')
    writeFileSync(path, '{not json!!')
    expect(loadCache('user-1', path)).toBeNull()
  })

  it('returns null for a mismatched userId (cache is per-user)', () => {
    const path = join(tmp, 'cache.json')
    saveCache(sampleCache({ userId: 'other-user' }), path)
    expect(loadCache('user-1', path)).toBeNull()
  })

  it('returns null for an unsupported cache version', () => {
    const path = join(tmp, 'cache.json')
    saveCache(sampleCache({ version: 999 }), path)
    expect(loadCache('user-1', path)).toBeNull()
  })

  it('ignores a cache file that was truncated mid-write (temp + rename keeps atomicity)', () => {
    const path = join(tmp, 'cache.json')
    // A partial file with valid prefix JSON but wrong shape
    writeFileSync(path, JSON.stringify({ version: CACHE_VERSION, userId: 'user-1' }))
    expect(loadCache('user-1', path)).toBeNull()
  })
})

describe('mergeLogs', () => {
  const a = syntheticLog({ id: 'log-a' })
  const b = syntheticLog({ id: 'log-b' })

  it('merges fresh logs into existing, deduping by id', () => {
    const merged = mergeLogs([a], [b])
    expect(merged.map((l) => l.id)).toEqual(['log-a', 'log-b'])
  })

  it('lets fresh copies win over cached ones (edits re-fetched on resume)', () => {
    const edited = syntheticLog({ id: 'log-a', name: { en: 'Edited Day' } })
    const merged = mergeLogs([a, b], [edited])
    expect(merged).toHaveLength(2)
    expect(merged.find((l) => l.id === 'log-a')?.name).toEqual({ en: 'Edited Day' })
  })

  it('returns the existing array unchanged when nothing fresh arrives', () => {
    const existing = [a]
    expect(mergeLogs(existing, [])).toBe(existing)
  })
})

describe('fullResyncDue', () => {
  const DAY = 86_400_000
  const now = Date.parse('2026-08-07T00:00:00.000Z')

  it('is due when no full sync has ever been recorded (pre-upgrade cache)', () => {
    expect(fullResyncDue({ lastFullSyncAt: undefined }, now, 30)).toBe(true)
  })

  it('is not due within the interval', () => {
    expect(fullResyncDue({ lastFullSyncAt: new Date(now - 29 * DAY).toISOString() }, now, 30)).toBe(
      false,
    )
  })

  it('is due once the interval has elapsed', () => {
    expect(fullResyncDue({ lastFullSyncAt: new Date(now - 30 * DAY).toISOString() }, now, 30)).toBe(
      true,
    )
  })

  it('is due for an unparseable lastFullSyncAt', () => {
    expect(fullResyncDue({ lastFullSyncAt: 'not-a-date' }, now, 30)).toBe(true)
  })
})

describe('parseFullSyncIntervalDays', () => {
  it('defaults when unset', () => {
    expect(parseFullSyncIntervalDays(undefined)).toBe(DEFAULT_FULL_SYNC_INTERVAL_DAYS)
  })

  it('defaults on garbage and non-positive values', () => {
    expect(parseFullSyncIntervalDays('abc')).toBe(DEFAULT_FULL_SYNC_INTERVAL_DAYS)
    expect(parseFullSyncIntervalDays('0')).toBe(DEFAULT_FULL_SYNC_INTERVAL_DAYS)
    expect(parseFullSyncIntervalDays('-5')).toBe(DEFAULT_FULL_SYNC_INTERVAL_DAYS)
  })

  it('parses a valid value and floors fractions', () => {
    expect(parseFullSyncIntervalDays('14')).toBe(14)
    expect(parseFullSyncIntervalDays('14.9')).toBe(14)
  })
})
