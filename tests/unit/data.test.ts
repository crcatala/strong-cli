import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import type { TokenState, TokenStore } from '../../src/api/token-manager.js'
import type { RawLog } from '../../src/api/types.js'
import { loadCache } from '../../src/lib/cache.js'
import { loadWorkoutData } from '../../src/lib/data.js'
import {
  futureJwt,
  MEASUREMENT_IDS,
  mockResponse,
  syntheticLog,
  syntheticUserResponse,
} from '../helpers/fixtures.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-data-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function memStore(initial: TokenState): TokenStore {
  let state = initial
  return {
    read: async () => state,
    write: async (s: TokenState) => {
      state = s
    },
  }
}

const globalMeasurements = [
  { id: MEASUREMENT_IDS.squatMachine, name: { en: 'Squat (Machine)' } },
  { id: MEASUREMENT_IDS.uprightRowDumbbell, name: { en: 'Upright Row (Dumbbell)' } },
]

function session(overrides: Partial<TokenState> = {}): TokenState {
  return {
    accessToken: futureJwt(3600, 'user-1'),
    refreshToken: 'rt-1',
    userId: 'user-1',
    expiresAt: Date.now() + 3_600_000,
    username: 'tester',
    ...overrides,
  }
}

function makeClient(fetchImpl: typeof fetch): StrongClient {
  return new StrongClient({
    baseUrl: 'https://back.strong.app',
    store: memStore(session()),
    fetch: fetchImpl,
  })
}

const PAGE1 = (): RawLog[] => [syntheticLog({ id: 'log-1' }), syntheticLog({ id: 'log-2' })]
const TAIL = (): RawLog[] => [syntheticLog({ id: 'log-3' })]
const TAIL_GROWN = (): RawLog[] => [syntheticLog({ id: 'log-3' }), syntheticLog({ id: 'log-4' })]

function pageResponse(logs: RawLog[], nextContinuation: string | null) {
  return mockResponse({
    id: 'user-1',
    _embedded: { log: logs },
    ...(nextContinuation
      ? {
          _links: {
            next: {
              href: `/api/users/user-1?include=log&continuation=${nextContinuation}&limit=200`,
            },
          },
        }
      : {}),
  })
}

/** Standard data-loading mock: paginated logs ('' = start, TOKEN2 = tail). */
function standardMock(opts: { grownTail?: boolean; tailStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('include=log')) {
      const cont = new URL(url).searchParams.get('continuation')
      if (cont === '') return pageResponse(PAGE1(), 'TOKEN2')
      if (cont === 'TOKEN2') {
        if (opts.tailStatus && opts.tailStatus >= 400) {
          return mockResponse({ title: 'Bad Request' }, { status: opts.tailStatus })
        }
        return pageResponse(opts.grownTail ? TAIL_GROWN() : TAIL(), null)
      }
      throw new Error(`unexpected continuation in data test: ${cont}`)
    }
    if (url.includes('include=measurement')) return mockResponse(syntheticUserResponse([]))
    if (url.includes('/api/measurements')) {
      return mockResponse({ _embedded: { measurement: globalMeasurements } })
    }
    throw new Error(`unexpected url in data test: ${url}`)
  })
}

describe('loadWorkoutData with the incremental cache', () => {
  it('does a full walk on first run, persists the cursor, then resumes incrementally', async () => {
    const cachePath = join(tmp, 'cache.json')
    const fetchImpl = standardMock()

    const client = makeClient(fetchImpl)
    const first = await loadWorkoutData(client, { cachePath })
    expect(first.cache.fromCache).toBe(false)
    expect(first.workouts.map((w) => w.id)).toEqual(['log-1', 'log-2', 'log-3'])

    const cached = loadCache('user-1', cachePath)
    expect(cached?.logs.map((l) => l.id)).toEqual(['log-1', 'log-2', 'log-3'])
    expect(cached?.continuation).toBe('TOKEN2')
    expect(cached?.finalized).toBe(true)

    // Server gains a workout; second run must resume from the stored cursor
    // (never re-fetch the first page) and merge the new tail in.
    fetchImpl.mockImplementation(standardMock({ grownTail: true }))
    const second = await loadWorkoutData(client, { cachePath })
    expect(second.cache.fromCache).toBe(true)
    expect(second.workouts.map((w) => w.id)).toEqual(['log-1', 'log-2', 'log-3', 'log-4'])

    const logCalls = fetchImpl.mock.calls
      .map(([input]) => String(input))
      .filter((u) => u.includes('include=log'))
    expect(logCalls).toHaveLength(3) // run 1: '', TOKEN2 · run 2: TOKEN2 only
    const lastLogCall = logCalls.at(-1) ?? ''
    expect(new URL(lastLogCall).searchParams.get('continuation')).toBe('TOKEN2')
  })

  it('does not rewrite the cache file when a resume returns nothing new', async () => {
    const cachePath = join(tmp, 'cache.json')
    const client = makeClient(standardMock())
    await loadWorkoutData(client, { cachePath }) // full walk → cache written
    const afterRun1 = readFileSync(cachePath, 'utf8')

    // A real server would re-deliver byte-identical pages, so serve ONE stable
    // fixture object for runs 2+3 instead of regenerating random UUIDs.
    const grownTail = TAIL_GROWN()
    const stableMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('include=log')) {
        const cont = new URL(url).searchParams.get('continuation')
        if (cont === 'TOKEN2') return pageResponse(grownTail, null)
        if (cont === '') return pageResponse(PAGE1(), 'TOKEN2')
        throw new Error(`unexpected continuation: ${cont}`)
      }
      if (url.includes('include=measurement')) return mockResponse(syntheticUserResponse([]))
      if (url.includes('/api/measurements')) {
        return mockResponse({ _embedded: { measurement: globalMeasurements } })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const client2 = makeClient(stableMock)

    await loadWorkoutData(client2, { cachePath }) // resume picks up log-4 → rewrite
    const afterRun2 = readFileSync(cachePath, 'utf8')
    expect(afterRun2).not.toBe(afterRun1)

    await loadWorkoutData(client2, { cachePath }) // same page re-delivered → no rewrite
    expect(readFileSync(cachePath, 'utf8')).toBe(afterRun2)
  })

  it('--fresh bypasses the cache and re-syncs the full history', async () => {
    const cachePath = join(tmp, 'cache.json')
    const client = makeClient(standardMock())
    await loadWorkoutData(client, { cachePath })

    // History changes *behind* the cursor (an old bulk import re-landed).
    const freshMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('include=log')) {
        const cont = new URL(url).searchParams.get('continuation')
        if (cont === '') {
          return pageResponse([syntheticLog({ id: 'log-0' }), ...PAGE1()], 'TOKEN2')
        }
        if (cont === 'TOKEN2') return pageResponse(TAIL(), null)
        throw new Error(`unexpected continuation: ${cont}`)
      }
      if (url.includes('include=measurement')) return mockResponse(syntheticUserResponse([]))
      if (url.includes('/api/measurements')) {
        return mockResponse({ _embedded: { measurement: globalMeasurements } })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const client2 = makeClient(freshMock)

    const fresh = await loadWorkoutData(client2, { cachePath, fresh: true })
    expect(fresh.cache.fromCache).toBe(false)
    expect(fresh.workouts.map((w) => w.id)).toEqual(['log-0', 'log-1', 'log-2', 'log-3'])
    expect(loadCache('user-1', cachePath)?.logs.map((l) => l.id)).toEqual([
      'log-0',
      'log-1',
      'log-2',
      'log-3',
    ])
  })

  it('falls back to a full walk when the stored cursor is rejected (HTTP 400)', async () => {
    const cachePath = join(tmp, 'cache.json')
    const client = makeClient(standardMock())
    await loadWorkoutData(client, { cachePath })

    // The stored cursor goes stale: the server rejects the resume once, then
    // serves a full history from the first page. loadWorkoutData must recover
    // with a full re-walk, not crash or loop.
    let resumeCount = 0
    const staleMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('include=log')) {
        const cont = new URL(url).searchParams.get('continuation')
        if (cont === '') return pageResponse(PAGE1(), 'TOKEN2')
        if (cont === 'TOKEN2' && resumeCount++ === 0) {
          return mockResponse({ title: 'Bad Request' }, { status: 400 })
        }
        if (cont === 'TOKEN2') return pageResponse(TAIL(), null)
        throw new Error(`unexpected continuation: ${cont}`)
      }
      if (url.includes('include=measurement')) return mockResponse(syntheticUserResponse([]))
      if (url.includes('/api/measurements')) {
        return mockResponse({ _embedded: { measurement: globalMeasurements } })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const client2 = makeClient(staleMock)

    const data = await loadWorkoutData(client2, { cachePath })
    expect(data.workouts.map((w) => w.id)).toEqual(['log-1', 'log-2', 'log-3'])
    const logCalls = staleMock.mock.calls
      .map(([input]) => String(input))
      .filter((u) => u.includes('include=log'))
    expect(logCalls).toHaveLength(3) // resume 400 → full walk '' → TOKEN2
    // The recovered cache is persisted and resumable.
    expect(loadCache('user-1', cachePath)?.logs.map((l) => l.id)).toEqual([
      'log-1',
      'log-2',
      'log-3',
    ])
  })
})
