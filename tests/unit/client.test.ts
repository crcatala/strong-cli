import { describe, expect, it, vi } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import type { TokenState, TokenStore } from '../../src/api/token-manager.js'
import type { RawLog, UserResponse } from '../../src/api/types.js'
import { ApiError, AuthError } from '../../src/cli/errors.js'
import {
  createFetchMock,
  fakeLoginResponse,
  futureJwt,
  mockResponse,
  syntheticLog,
  syntheticUserResponse,
} from '../helpers/fixtures.js'

function memStore(initial: TokenState | null = null): TokenStore {
  let state = initial
  return {
    read: vi.fn(async () => state),
    write: vi.fn(async (s: TokenState) => {
      state = s
    }),
  }
}

function makeClient(store: TokenStore, fetchImpl: typeof fetch) {
  return new StrongClient({ baseUrl: 'https://back.strong.app', store, fetch: fetchImpl })
}

describe('StrongClient', () => {
  it('logs in and stores the session', async () => {
    const store = memStore()
    const loginResponse = fakeLoginResponse()
    const fetchImpl = createFetchMock([
      {
        match: (url, init) => url.includes('/auth/login') && init?.method === 'POST',
        handler: () => mockResponse(loginResponse),
      },
    ])
    const client = makeClient(store, fetchImpl)
    const session = await client.login('user@example.com', 'hunter2', 'dev-1')
    expect(session.userId).toBe('test-user-123')
    expect(store.write).toHaveBeenCalled()
    expect(session.deviceId).toBe('dev-1')
  })

  it('throws AuthError on 401 login', async () => {
    const store = memStore()
    const fetchImpl = createFetchMock([
      {
        match: (url, init) => url.includes('/auth/login') && init?.method === 'POST',
        handler: () => mockResponse({ error: 'unauthorized' }, { status: 401 }),
      },
    ])
    const client = makeClient(store, fetchImpl)
    await expect(client.login('u', 'p')).rejects.toBeInstanceOf(AuthError)
  })

  it('fetches the public measurements endpoint without auth', async () => {
    const store = memStore()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/measurements')) {
        return mockResponse({ total: 2, _embedded: { measurement: [{ id: 'm1' }] } })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const client = makeClient(store, fetchImpl)
    const res = await client.getMeasurements(1)
    expect(res.total).toBe(2)
    const call = fetchImpl.mock.calls[0]
    const headers = new Headers(call[1]?.headers)
    expect(headers.has('authorization')).toBe(false)
  })

  it('retries once with a fresh token after a 401', async () => {
    const initial = {
      accessToken: futureJwt(1200, 'user-1', 'initial'),
      refreshToken: 'rt-1',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    }
    const store = memStore(initial)
    const refreshedToken = futureJwt(1200, 'user-1', 'refreshed')

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/login/refresh')) {
        return mockResponse({
          accessToken: refreshedToken,
          refreshToken: 'rt-2',
          expiresIn: 1200,
        })
      }
      if (url.includes('/api/users/')) {
        const auth = new Headers(init?.headers).get('authorization')
        if (auth !== `Bearer ${refreshedToken}`) {
          return mockResponse({ title: 'Unauthorized' }, { status: 401 })
        }
        return mockResponse(syntheticUserResponse([]))
      }
      throw new Error(`unexpected url ${url}`)
    })

    const client = makeClient(store, fetchImpl)
    const user = await client.getUser('user-1')
    expect(user.id).toBe('test-user-123')
    const written = (store.write as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as TokenState
    expect(written.refreshToken).toBe('rt-2')
  })

  it('throws ApiError on other failures', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const fetchImpl = createFetchMock([
      {
        match: (url) => url.includes('/api/users/'),
        handler: () => mockResponse({}, { status: 500 }),
      },
    ])
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { baseDelayMs: 1 },
    })
    await expect(client.getUser('user-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('retries 5xx then succeeds', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      return calls < 3 ? mockResponse({}, { status: 500 }) : mockResponse(syntheticUserResponse([]))
    })
    // Tiny base delay keeps the test fast; jittered sleep is ~1ms.
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { baseDelayMs: 1 },
    })
    const user = await client.getUser('user-1')
    expect(user.id).toBe('test-user-123')
    expect(calls).toBe(3) // 2 retries after the initial failure
  })

  it('retries 429 rate limits with backoff then succeeds', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls < 3) {
        return mockResponse(
          { message: 'Something went wrong. Please try again later.' },
          { status: 429 },
        )
      }
      return mockResponse(syntheticUserResponse([]))
    })
    // Tiny base delay keeps the test fast; jittered sleep is ~1ms.
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { baseDelayMs: 1 },
    })
    const user = await client.getUser('user-1')
    expect(user.id).toBe('test-user-123')
    expect(calls).toBe(3)
  })

  it('exhausts retries on a persistent 429 soft rate limit', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const fetchImpl = vi.fn(async () =>
      mockResponse({ message: 'Something went wrong. Please try again later.' }, { status: 429 }),
    )
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { baseDelayMs: 1 },
    })
    await expect(client.getUser('user-1')).rejects.toBeInstanceOf(ApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('honors retryRateLimited=false (429 fails through immediately)', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const fetchImpl = vi.fn(async () =>
      mockResponse({ message: 'Something went wrong. Please try again later.' }, { status: 429 }),
    )
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { retryRateLimited: false },
    })
    await expect(client.getUser('user-1')).rejects.toBeInstanceOf(ApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('respects a custom maxRetries', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const fetchImpl = vi.fn(async () => mockResponse({}, { status: 503 }))
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store,
      fetch: fetchImpl,
      retry: { maxRetries: 5, baseDelayMs: 1 },
    })
    await expect(client.getUser('user-1')).rejects.toBeInstanceOf(ApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(6) // initial + 5 retries
  })

  it('paginates logs following _links.next', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const page1: UserResponse = {
      id: 'user-1',
      _links: {
        next: {
          href: '/api/users/user-1?include=log&continuation=TOKEN2&limit=1',
        },
      },
      _embedded: { log: [syntheticLog({ id: 'log-1' })] },
    }
    const page2: UserResponse = {
      id: 'user-1',
      _embedded: { log: [syntheticLog({ id: 'log-2' })] },
    }

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('continuation=TOKEN2')) return mockResponse(page2)
      return mockResponse(page1)
    })

    const client = makeClient(store, fetchImpl)
    const logs: RawLog[] = await client.getAllLogs('user-1', 1, { pageDelayMs: 0 })
    expect(logs.map((l) => l.id)).toEqual(['log-1', 'log-2'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // First page request carries the (empty) continuation param, like the
    // verified reference clients — the API can 400 when it is omitted.
    const firstUrl = String(fetchImpl.mock.calls[0][0])
    expect(firstUrl).toContain('continuation=')
    expect(firstUrl).toContain('limit=1')
    expect(firstUrl).toContain('include=log')
  })

  it('aborts getAllLogs at the maxPages safety cap instead of looping forever', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    // A page chain that never ends, but with distinct tokens — exercises the page cap
    // (a repeating token is covered by the loop-detection test below).
    let page = 0
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        id: 'user-1',
        _links: {
          next: { href: `/api/users/user-1?include=log&continuation=TOKEN${++page}&limit=1` },
        },
        _embedded: { log: [syntheticLog({ id: 'log-1' })] },
      }),
    )

    const client = makeClient(store, fetchImpl)
    await expect(client.getAllLogs('user-1', 1, { maxPages: 3, pageDelayMs: 0 })).rejects.toThrow(
      /safety cap/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('aborts getAllLogs when a continuation token repeats (self-referencing next)', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const looping: UserResponse = {
      id: 'user-1',
      _links: {
        next: { href: '/api/users/user-1?include=log&continuation=LOOP&limit=1' },
      },
      _embedded: { log: [syntheticLog({ id: 'log-x' })] },
    }
    const fetchImpl = vi.fn(async () => mockResponse(looping))

    const client = makeClient(store, fetchImpl)
    await expect(client.getAllLogs('user-1', 1, { pageDelayMs: 0 })).rejects.toThrow(
      /Pagination loop detected/,
    )
    // First page returns continuation=LOOP; second page repeats it → abort before a third.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('paces paginated page requests with the configured delay', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const page1: UserResponse = {
      id: 'user-1',
      _links: {
        next: { href: '/api/users/user-1?include=log&continuation=TOKEN2&limit=1' },
      },
      _embedded: { log: [syntheticLog({ id: 'log-1' })] },
    }
    const page2: UserResponse = {
      id: 'user-1',
      _embedded: { log: [syntheticLog({ id: 'log-2' })] },
    }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('continuation=TOKEN2')) return mockResponse(page2)
      return mockResponse(page1)
    })

    const client = makeClient(store, fetchImpl)
    const started = performance.now()
    await client.getAllLogs('user-1', 1, { pageDelayMs: 30 })
    const elapsed = performance.now() - started
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // One inter-page sleep of 30ms — assert with slack so the test is not flaky.
    expect(elapsed).toBeGreaterThanOrEqual(20)
  })

  it('paginates measurements across pages following _links.next', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('page=2')) {
        return mockResponse({ _embedded: { measurement: [{ id: 'm2' }] } })
      }
      return mockResponse({
        _embedded: { measurement: [{ id: 'm1' }] },
        _links: { next: { href: '/api/measurements?page=2' } },
      })
    })
    const client = makeClient(memStore(), fetchImpl)
    const res = await client.getAllMeasurements({ pageDelayMs: 0 })
    expect(res._embedded?.measurement?.map((m) => (m as { id: string }).id)).toEqual(['m1', 'm2'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts getAllMeasurements at the maxPages safety cap', async () => {
    const endless = {
      _embedded: { measurement: [{ id: 'm1' }] },
      _links: { next: { href: '/api/measurements?page=2' } },
    }
    const fetchImpl = vi.fn(async () => mockResponse(endless))
    const client = makeClient(memStore(), fetchImpl)
    await expect(client.getAllMeasurements({ maxPages: 2, pageDelayMs: 0 })).rejects.toThrow(
      /safety cap/,
    )
    // page 1 + page 2 are fetched; the guard throws before a third request.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('includes the server response body in ApiError detail', async () => {
    const store = memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    })
    const fetchImpl = vi.fn(async () =>
      mockResponse(
        { title: 'Bad Request', detail: 'continuation parameter is required' },
        { status: 400 },
      ),
    )
    const client = makeClient(store, fetchImpl)
    await expect(client.getUser('user-1')).rejects.toThrow(/continuation parameter is required/)
  })
})
