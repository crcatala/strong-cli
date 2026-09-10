import { describe, expect, it, vi } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import { classifyHttpRoute, HttpStats } from '../../src/api/http-stats.js'
import type { TokenState, TokenStore } from '../../src/api/token-manager.js'
import { futureJwt, mockResponse, syntheticUserResponse } from '../helpers/fixtures.js'

function store(): TokenStore {
  const state: TokenState = {
    accessToken: futureJwt(1200, 'private-user', 'initial-token'),
    refreshToken: 'private-refresh-token',
    userId: 'private-user',
    expiresAt: Date.now() + 1_200_000,
  }
  return { read: async () => state, write: async () => undefined }
}

describe('privacy-safe HTTP statistics', () => {
  it('records a successful response body without retaining route values or its contents', async () => {
    const stats = new HttpStats()
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: store(),
      httpStats: stats,
      fetch: vi.fn(async () => mockResponse({ privateResponse: 'do-not-report' })),
    })

    await client.getUser('private-user', { continuation: 'secret-cursor' })

    const report = stats.report()
    expect(report.attempts).toBe(1)
    expect(report.responseBytes).toBeGreaterThan(0)
    expect(report.routes['user-metadata']).toEqual({ attempts: 1, statuses: { '200': 1 } })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toMatch(/private-user|secret-cursor|do-not-report/i)
    expect(serialized).not.toContain('initial-token')
  })

  it('counts a 401 retry and its token refresh as real attempts', async () => {
    const stats = new HttpStats()
    const freshToken = futureJwt(1200, 'private-user', 'fresh-token')
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/login/refresh')) {
        return mockResponse({
          accessToken: freshToken,
          refreshToken: 'next-secret',
          expiresIn: 1200,
        })
      }
      return new Headers(init?.headers).get('authorization') === `Bearer ${freshToken}`
        ? mockResponse(syntheticUserResponse([]))
        : mockResponse({ hidden: 'body' }, { status: 401 })
    })
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: store(),
      fetch,
      httpStats: stats,
    })

    await client.getUser('private-user')

    const report = stats.report()
    expect(report).toMatchObject({ attempts: 3, retries: 1, tokenRefreshes: 1 })
    expect(report.routes['auth-refresh'].attempts).toBe(1)
    expect(report.routes['user-metadata'].statuses).toEqual({ '200': 1, '401': 1 })
  })

  it('counts 5xx retries as real attempts', async () => {
    const stats = new HttpStats()
    let calls = 0
    const fetch = vi.fn(async () =>
      ++calls === 1 ? mockResponse({}, { status: 503 }) : mockResponse(syntheticUserResponse([])),
    )
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: store(),
      fetch,
      httpStats: stats,
      retry: { maxRetries: 1, baseDelayMs: 1 },
    })

    await client.getUser('private-user')

    expect(stats.report()).toMatchObject({ attempts: 2, retries: 1 })
  })

  it('counts retryable and terminal failures without response-body logging', async () => {
    const stats = new HttpStats()
    const fetch = vi.fn(async () => mockResponse({ sensitive: 'nope' }, { status: 429 }))
    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: store(),
      fetch,
      httpStats: stats,
      retry: { maxRetries: 1, baseDelayMs: 1 },
    })

    await expect(client.getUser('private-user')).rejects.toThrow('HTTP 429')

    expect(stats.report()).toMatchObject({ attempts: 2, retries: 1 })
    expect(JSON.stringify(stats.report())).not.toContain('sensitive')
  })

  it('uses fixed route labels for sensitive endpoint shapes', () => {
    expect(
      classifyHttpRoute('https://back.strong.app/api/users/user-123?include=log&continuation=abc'),
    ).toBe('logs-page')
    expect(classifyHttpRoute('https://back.strong.app/api/users/user-123/logs/log-456')).toBe(
      'user-log-detail',
    )
  })
})
