import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import { HttpStats } from '../../src/api/http-stats.js'
import {
  DEFAULT_GLOBAL_MEASUREMENTS_TTL_MS,
  GLOBAL_MEASUREMENTS_CACHE_VERSION,
  loadGlobalMeasurementsCache,
  normalizeBackendUrl,
  saveGlobalMeasurementsCache,
} from '../../src/api/measurement-cache.js'
import type { TokenStore } from '../../src/api/token-manager.js'
import type { MeasurementsResponse } from '../../src/api/types.js'
import { mockResponse } from '../helpers/fixtures.js'

let tmp: string
const baseUrl = 'https://BACK.example.test/api/'
const cachePath = () => join(tmp, 'global.json')
const now = Date.parse('2026-09-10T00:00:00.000Z')
const measurements: MeasurementsResponse = { _embedded: { measurement: [{ id: 'squat' }] } }

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-global-cache-'))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const store: TokenStore = { read: async () => null, write: async () => undefined }

function client(fetchImpl: typeof globalThis.fetch, stats?: HttpStats, path = cachePath()) {
  return new StrongClient({
    baseUrl,
    store,
    fetch: fetchImpl,
    now: () => now,
    httpStats: stats,
    globalMeasurementsCachePath: path,
  })
}

describe('global measurements cache record', () => {
  it('isolates entries by normalized backend URL and schema version', () => {
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now).toISOString(), cachePath())
    expect(normalizeBackendUrl(baseUrl)).toBe('https://back.example.test/api')
    expect(
      loadGlobalMeasurementsCache('https://back.example.test/api', now, undefined, cachePath()),
    ).not.toBeNull()
    expect(
      loadGlobalMeasurementsCache('https://other.example.test/api', now, undefined, cachePath()),
    ).toBeNull()
    writeFileSync(
      cachePath(),
      JSON.stringify({
        version: GLOBAL_MEASUREMENTS_CACHE_VERSION + 1,
        backendUrl: normalizeBackendUrl(baseUrl),
        fetchedAt: new Date(now).toISOString(),
        measurements,
      }),
    )
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())).toBeNull()
  })

  it('treats corrupt and future-dated records as misses and recognizes expiry', () => {
    writeFileSync(cachePath(), '{bad json')
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())).toBeNull()
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now + 1).toISOString(), cachePath())
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())).toBeNull()
    saveGlobalMeasurementsCache(
      baseUrl,
      measurements,
      new Date(now - DEFAULT_GLOBAL_MEASUREMENTS_TTL_MS).toISOString(),
      cachePath(),
    )
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())?.provenance).toBe(
      'expired',
    )
  })
})

describe('StrongClient global measurements cache', () => {
  it('uses an unexpired entry without any global-measurement HTTP request', async () => {
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now).toISOString(), cachePath())
    const fetch = vi.fn()
    const result = await client(fetch as unknown as typeof globalThis.fetch).getAllMeasurements()
    expect(result).toEqual(measurements)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a hit to HTTP statistics without recording an HTTP attempt', async () => {
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now).toISOString(), cachePath())
    const stats = new HttpStats(() => now)
    await client(vi.fn() as unknown as typeof globalThis.fetch, stats).getAllMeasurements()
    expect(stats.report()).toMatchObject({
      attempts: 0,
      cache: { globalMeasurements: 'hit' },
    })
  })

  it('walks all pages on a miss and atomically replaces the record', async () => {
    saveGlobalMeasurementsCache(
      baseUrl,
      { _embedded: { measurement: [{ id: 'old' }] } },
      new Date(now - DEFAULT_GLOBAL_MEASUREMENTS_TTL_MS).toISOString(),
      cachePath(),
    )
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).includes('page=2')
        ? mockResponse({ _embedded: { measurement: [{ id: 'deadlift' }] } })
        : mockResponse({
            _embedded: { measurement: [{ id: 'squat' }] },
            _links: { next: { href: '/api/measurements?page=2' } },
          })
    })
    const result = await client(fetch).getAllMeasurements({ pageDelayMs: 0 })
    expect(result._embedded?.measurement).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())?.measurements).toEqual(
      result,
    )
  })

  it('--fresh bypasses and replaces a warm entry', async () => {
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now).toISOString(), cachePath())
    const fetch = vi.fn(async () => mockResponse({ _embedded: { measurement: [{ id: 'fresh' }] } }))
    const current = await client(fetch).getAllMeasurements({ fresh: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(current._embedded?.measurement).toEqual([{ id: 'fresh' }])
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())?.measurements).toEqual(
      current,
    )
  })

  it('returns fetched data when cache persistence fails', async () => {
    const blockedParent = join(tmp, 'not-a-directory')
    writeFileSync(blockedParent, 'file')
    const fetch = vi.fn(async () => mockResponse(measurements))
    await expect(
      client(fetch, undefined, join(blockedParent, 'global.json')).getAllMeasurements(),
    ).resolves.toEqual(measurements)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not replace an existing cache after incomplete pagination fails', async () => {
    saveGlobalMeasurementsCache(baseUrl, measurements, new Date(now).toISOString(), cachePath())
    const fetch = vi.fn(async () =>
      mockResponse({
        _embedded: { measurement: [] },
        _links: { next: { href: '/api/measurements?page=2' } },
      }),
    )
    await expect(client(fetch).getAllMeasurements({ fresh: true, pageDelayMs: 0 })).rejects.toThrow(
      /incomplete library/,
    )
    expect(loadGlobalMeasurementsCache(baseUrl, now, undefined, cachePath())?.measurements).toEqual(
      measurements,
    )
  })
})
