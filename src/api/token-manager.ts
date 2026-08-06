import { decodeJwt } from './jwt.js'

/**
 * A persisted authentication session.
 */
export interface TokenState {
  accessToken: string
  refreshToken: string
  userId: string
  deviceId?: string
  /** Access token expiry as epoch milliseconds (from JWT exp claim). */
  expiresAt: number
  /** Login username/email for display (not required by the API). */
  username?: string
}

export interface TokenStore {
  read(): Promise<TokenState | null>
  write(state: TokenState): Promise<void>
}

export type RefreshFn = (body: {
  accessToken: string
  refreshToken: string
  deviceId?: string
}) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>

interface Options {
  store: TokenStore
  refresh: RefreshFn
  now?: () => number
  /** Refresh this far before the JWT actually expires. Default 60s. */
  skewMs?: number
}

/**
 * Owns access-token lifecycle: proactive refresh before JWT expiry, single
 * in-flight refresh (so concurrent requests share one call), rotation, and
 * persistence-before-return so a crash cannot leave a stale token behind.
 *
 * Pattern adapted from jerhinesmith/strong-mcp (MIT).
 */
export class TokenManager {
  private state: TokenState | null = null
  private inFlight: Promise<string> | null = null
  private readonly skewMs: number
  private readonly now: () => number

  constructor(private readonly opts: Options) {
    this.skewMs = opts.skewMs ?? 60_000
    this.now = opts.now ?? (() => Date.now())
  }

  async load(): Promise<TokenState | null> {
    if (this.state) return this.state
    const stored = await this.opts.store.read()
    if (stored) this.state = stored
    return stored
  }

  /** Get a usable access token, refreshing first if it is near/over expiry. */
  async getAccessToken(): Promise<string> {
    const s = await this.load()
    if (!s) throw new Error('Not authenticated — run `strong auth login` first')
    if (this.now() >= s.expiresAt - this.skewMs) {
      return this.forceRefresh()
    }
    return s.accessToken
  }

  forceRefresh(): Promise<string> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async doRefresh(): Promise<string> {
    const s = await this.load()
    if (!s?.refreshToken) {
      throw new Error('No refresh token available — run `strong auth login` again')
    }

    let res: Awaited<ReturnType<RefreshFn>>
    try {
      res = await this.opts.refresh({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        deviceId: s.deviceId,
      })
    } catch (err) {
      const underlying = err instanceof Error ? err.message : String(err)
      throw new Error(`Strong token refresh failed — re-run \`strong auth login\` (${underlying})`)
    }

    let expiresAt: number
    try {
      expiresAt = decodeJwt(res.accessToken).expMs
    } catch {
      // Fall back to the server-provided lifetime if the JWT is not decodable.
      expiresAt = this.now() + res.expiresIn * 1000
    }

    const next: TokenState = {
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      userId: s.userId,
      deviceId: s.deviceId,
      username: s.username,
      expiresAt,
    }
    // Persist BEFORE returning so concurrent/next processes see fresh tokens.
    await this.opts.store.write(next)
    this.state = next
    return next.accessToken
  }

  /** Replace the session wholesale (e.g. after an explicit login). */
  setSession(state: TokenState): void {
    this.state = state
  }
}
