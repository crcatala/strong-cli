import { describe, expect, it, vi } from 'vitest'
import { TokenManager, type TokenState, type TokenStore } from '../../src/api/token-manager.js'
import { fakeJwt, futureJwt } from '../helpers/fixtures.js'

function memStore(initial: TokenState | null = null): TokenStore {
  let state = initial
  return {
    read: vi.fn(async () => state),
    write: vi.fn(async (s: TokenState) => {
      state = s
    }),
  }
}

function freshState(expiresInSeconds = 1200): TokenState {
  return {
    accessToken: futureJwt(expiresInSeconds),
    refreshToken: 'refresh-token',
    userId: 'user-1',
    expiresAt: Date.now() + expiresInSeconds * 1000,
  }
}

describe('TokenManager', () => {
  it('returns the stored token when fresh', async () => {
    const store = memStore(freshState())
    const mgr = new TokenManager({ store, refresh: vi.fn() })
    const token = await mgr.getAccessToken()
    expect(token).toBeTruthy()
    expect(store.read).toHaveBeenCalled()
  })

  it('refreshes before expiry (skew) and persists the rotated pair', async () => {
    const store = memStore({
      ...freshState(0),
      expiresAt: Date.now() + 10_000, // 10s left, inside 60s skew
    })
    const newAccess = futureJwt(1200)
    const refresh = vi.fn(async () => ({
      accessToken: newAccess,
      refreshToken: 'rotated-refresh',
      expiresIn: 1200,
    }))

    const mgr = new TokenManager({ store, refresh, skewMs: 60_000 })
    const token = await mgr.getAccessToken()
    expect(token).toBe(newAccess)
    expect(refresh).toHaveBeenCalledWith({
      accessToken: expect.any(String),
      refreshToken: 'refresh-token',
      deviceId: undefined,
    })
    const written = (store.write as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as TokenState
    expect(written.refreshToken).toBe('rotated-refresh')
    expect(written.accessToken).toBe(newAccess)
  })

  it('deduplicates concurrent refreshes (single flight)', async () => {
    const store = memStore({ ...freshState(0), expiresAt: Date.now() - 1 })
    let refreshCalls = 0
    const refresh = vi.fn(async () => {
      refreshCalls++
      return { accessToken: futureJwt(1200), refreshToken: 'r2', expiresIn: 1200 }
    })

    const mgr = new TokenManager({ store, refresh, skewMs: 60_000 })
    const [a, b, c] = await Promise.all([
      mgr.getAccessToken(),
      mgr.getAccessToken(),
      mgr.getAccessToken(),
    ])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(refreshCalls).toBe(1)
  })

  it('throws a helpful error when there is no stored session', async () => {
    const mgr = new TokenManager({ store: memStore(null), refresh: vi.fn() })
    await expect(mgr.getAccessToken()).rejects.toThrow(/auth login/)
  })

  it('falls back to server expiresIn when JWT is not decodable', async () => {
    const store = memStore({ ...freshState(0), expiresAt: Date.now() - 1 })
    const refresh = vi.fn(async () => ({
      accessToken: fakeJwt({ no: 'exp' }),
      refreshToken: 'r3',
      expiresIn: 300,
    }))
    const now = Date.now()
    const mgr = new TokenManager({ store, refresh, now: () => now, skewMs: 60_000 })
    await mgr.getAccessToken()
    const written = (store.write as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as TokenState
    expect(written.expiresAt).toBe(now + 300_000)
  })
})
