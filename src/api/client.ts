import { ApiError, AuthError } from '../cli/errors.js'
import {
  CLIENT_HEADERS_DEFAULT,
  loginUrl,
  logsUrl,
  measurementsUrl,
  refreshUrl,
  STRONG_BACKEND_DEFAULT,
  userLogUrl,
  userMeasurementsUrl,
  userTemplatesUrl,
  userUrl,
} from './endpoints.js'
import { TokenManager, type TokenState, type TokenStore } from './token-manager.js'
import type {
  LoginRequest,
  LoginResponse,
  MeasurementsResponse,
  RawLog,
  RefreshRequest,
  Template,
  UserResponse,
} from './types.js'

export type ClientHeaders = Record<string, string>

export interface StrongClientOptions {
  baseUrl?: string
  store: TokenStore
  fetch?: typeof fetch
  headers?: ClientHeaders
  now?: () => number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Hard cap on pages walked by paginated fetches. Guards against a malformed /
 * self-referencing `_links.next` turning a fetch into an unbounded loop.
 * 10_000 × 200 logs = 2M workouts — far beyond any real history.
 */
export const DEFAULT_MAX_PAGES = 10_000

/**
 * Pacing between paginated page requests. The backend soft-rate-limits
 * (`Something went wrong. Please try again later.` 401/429), and rapid
 * pagination is exactly the kind of traffic that triggers it — so page walks
 * take a small breath between requests.
 */
export const DEFAULT_PAGE_DELAY_MS = 150

export interface PaginationOptions {
  /** Override the per-walk page cap (default {@link DEFAULT_MAX_PAGES}). */
  maxPages?: number
  /** Override the inter-page delay in ms (default {@link DEFAULT_PAGE_DELAY_MS}). */
  pageDelayMs?: number
}

/**
 * Result of a paginated logs walk (see {@link StrongClient.walkLogs}).
 *
 * `lastNextContinuation` is the continuation token of the last page the server
 * pointed us to (the resume point for a follow-up incremental walk — verified
 * live to re-deliver an identical page, so re-fetching from it is idempotent).
 * It is `''` when the walk never advanced past the first page.
 */
export interface LogsWalk {
  logs: RawLog[]
  /** Token to resume the next walk from; `''` = start from the first page. */
  lastNextContinuation: string
  /** True when the walk reached the end of the stream (no more `next` links). */
  finalized: boolean
}

/**
 * HTTP client for the undocumented Strong backend (https://back.strong.app).
 *
 * Handles: auth (login + token refresh via TokenManager), HAL response
 * unwrapping, 401-retry-once-after-refresh, and 5xx backoff.
 *
 * API knowledge triangulated from:
 * - tolik518/strong-api-workout-sync   (Rust, fixtures captured 2026-03)
 * - jerhinesmith/strong-mcp            (MIT, full read/write client)
 * - TheAlexLichter/strong-exporter     (TypeScript, read-only exporter)
 * - pratyaksh123/strong-api            (Python)
 * - ivanvmoreno/strong-skill           (Python/OpenClaw skill)
 */
export class StrongClient {
  readonly baseUrl: string
  readonly headers: ClientHeaders
  readonly tokenManager: TokenManager
  private readonly fetchImpl: typeof fetch

  constructor(private readonly opts: StrongClientOptions) {
    this.baseUrl = (opts.baseUrl ?? STRONG_BACKEND_DEFAULT).replace(/\/+$/, '')
    this.headers = { ...CLIENT_HEADERS_DEFAULT, ...opts.headers }
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis)
    this.tokenManager = new TokenManager({
      store: opts.store,
      now: opts.now,
      refresh: async (body: RefreshRequest) => {
        const res = await this.rawRequest('POST', refreshUrl(this.baseUrl), {
          body,
          auth: false,
        })
        return res as unknown as { accessToken: string; refreshToken: string; expiresIn: number }
      },
    })
  }

  // --------------------------------------------------------------------------
  // Auth
  // --------------------------------------------------------------------------

  /** Log in with email/username + password; stores the new session. */
  async login(usernameOrEmail: string, password: string, deviceId?: string): Promise<TokenState> {
    const body: LoginRequest = { usernameOrEmail, password }
    if (deviceId) body.deviceId = deviceId

    let response: Response
    try {
      response = await this.fetchImpl(loginUrl(this.baseUrl), {
        method: 'POST',
        headers: { ...this.headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new AuthError(
        `Network error while contacting ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('Login failed: invalid email/username or password (401)')
    }
    if (!response.ok) {
      throw new ApiError(`Login failed with HTTP ${response.status}`, response.status)
    }

    const data = (await response.json()) as LoginResponse
    if (!data.accessToken || !data.refreshToken || !data.userId) {
      throw new AuthError(
        'Login response missing expected fields (accessToken/refreshToken/userId)',
      )
    }

    const session: TokenState = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userId: data.userId,
      deviceId,
      username: usernameOrEmail,
      expiresAt: this.now() + data.expiresIn * 1000,
    }
    await this.opts.store.write(session)
    this.tokenManager.setSession(session)
    return session
  }

  // --------------------------------------------------------------------------
  // Core request
  // --------------------------------------------------------------------------

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  private async rawRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    opts: { body?: unknown; auth?: boolean } = {},
  ): Promise<unknown> {
    const { body, auth = true } = opts
    const headers: ClientHeaders = { ...this.headers }
    if (body !== undefined) headers['content-type'] = 'application/json'

    if (auth) {
      const token = await this.tokenManager.getAccessToken()
      headers.authorization = `Bearer ${token}`
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (response.status === 204) return undefined
    const text = await response.text()
    if (response.ok) {
      return text ? JSON.parse(text) : undefined
    }
    // Include the server's reason in the error so API failures are diagnosable.
    const detail = summarizeBody(text)
    throw new ApiError(
      `HTTP ${response.status} for ${method} ${url}${detail ? ` — ${detail}` : ''}`,
      response.status,
    )
  }

  /**
   * Authed request with 401-retry-once-after-refresh and 5xx backoff.
   */
  private async authedRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<T> {
    let refreshed = false
    let attempt = 0
    for (;;) {
      try {
        return (await this.rawRequest(method, url, { body })) as T
      } catch (err) {
        const status = err instanceof ApiError ? err.statusCode : undefined

        if (status === 401 && !refreshed) {
          refreshed = true
          await this.tokenManager.forceRefresh()
          continue
        }
        if (status !== undefined && status >= 500 && attempt < 2) {
          attempt++
          await sleep(250 * attempt)
          continue
        }
        throw err
      }
    }
  }

  // --------------------------------------------------------------------------
  // Public (no auth required)
  // --------------------------------------------------------------------------

  /** Exercise definitions, page by page (public — no auth needed). */
  async getMeasurements(page = 1): Promise<MeasurementsResponse> {
    return (await this.rawRequest('GET', measurementsUrl(this.baseUrl, page), {
      auth: false,
    })) as MeasurementsResponse
  }

  /**
   * All global exercise definitions across pages.
   *
   * Page-based pagination (`page=N`; no continuation token). Paced with a
   * delay between requests and capped at {@link DEFAULT_MAX_PAGES} pages —
   * exceeding the cap throws rather than silently truncating.
   */
  async getAllMeasurements(opts: PaginationOptions = {}): Promise<MeasurementsResponse> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES
    const pageDelayMs = opts.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
    const first = await this.getMeasurements(1)
    const measurements = [...(first._embedded?.measurement ?? [])]
    let next = first._links?.next
    for (let page = 2; next; page++) {
      if (page > maxPages) {
        throw new ApiError(
          `getAllMeasurements hit the ${maxPages}-page safety cap — aborting instead of following more ` +
            'pagination links (raise maxPages if this is a real, enormous library)',
        )
      }
      if (pageDelayMs > 0) await sleep(pageDelayMs)
      const more = await this.getMeasurements(page)
      const batch = more._embedded?.measurement ?? []
      if (batch.length === 0) break
      measurements.push(...batch)
      next = more._links?.next
    }
    return {
      ...first,
      _embedded: { ...(first._embedded ?? {}), measurement: measurements },
    }
  }

  // --------------------------------------------------------------------------
  // Authed
  // --------------------------------------------------------------------------

  async getUser(
    userId: string,
    opts: { limit?: number; continuation?: string; includes?: string[] } = {},
  ): Promise<UserResponse> {
    return this.authedRequest<UserResponse>(
      'GET',
      userUrl(this.baseUrl, userId, {
        limit: opts.limit ?? 500,
        continuation: opts.continuation ?? '',
        includes: opts.includes ?? [],
      }),
    )
  }

  /**
   * Fetch every workout log, following `_links.next` continuation pagination.
   *
   * @see walkLogs for the shared implementation and safety guards.
   */
  async getAllLogs(userId: string, limit = 200, opts: PaginationOptions = {}): Promise<RawLog[]> {
    return (await this.walkLogs(userId, { limit, ...opts })).logs
  }

  /**
   * Walk the user's workout logs following `_links.next` continuation
   * pagination, optionally resuming from a previously stored continuation
   * token (incremental sync; see the key decisions in PLAN.md).
   *
   * Safety: capped at {@link DEFAULT_MAX_PAGES} pages, aborts on a repeated
   * continuation token (self-referencing `next` loop), and paces page requests
   * to avoid tripping the backend's soft rate limiter. Exceeding the cap or
   * detecting a loop throws {@link ApiError} — a truncated history would
   * silently corrupt stats, so we fail loudly instead.
   */
  async walkLogs(
    userId: string,
    walk: { limit?: number; continuation?: string; maxPages?: number; pageDelayMs?: number } = {},
  ): Promise<LogsWalk> {
    const limit = walk.limit ?? 200
    const maxPages = walk.maxPages ?? DEFAULT_MAX_PAGES
    const pageDelayMs = walk.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
    const logs: RawLog[] = []
    const seenContinuations = new Set<string>()
    let continuation = walk.continuation ?? ''
    let lastNextContinuation = ''
    let finalized = false
    for (let page = 0; ; page++) {
      if (page >= maxPages) {
        throw new ApiError(
          `getAllLogs hit the ${maxPages}-page safety cap — aborting instead of following more pagination ` +
            'links (raise maxPages if this is a real, enormous history)',
        )
      }
      const user = await this.getUser(userId, {
        limit,
        continuation,
        includes: ['log'],
      })
      const batch = user._embedded?.log ?? []
      logs.push(...batch)

      const next = user._links?.next
      if (!next || typeof next !== 'object' || !('href' in next) || batch.length === 0) {
        // End of stream: nothing more to follow (empty batches are treated as
        // exhaustion — resuming re-fetches them idempotently).
        finalized = true
        break
      }
      const href = (next as { href: string }).href
      const nextUrl = new URL(href, this.baseUrl)
      const nextContinuation = nextUrl.searchParams.get('continuation') ?? ''
      if (!nextContinuation) {
        finalized = true
        break
      }
      if (seenContinuations.has(nextContinuation)) {
        throw new ApiError(
          `Pagination loop detected in getAllLogs: continuation token repeated after ${page + 1} ` +
            'page(s) — refusing to keep following a self-referencing next link',
        )
      }
      seenContinuations.add(nextContinuation)
      lastNextContinuation = nextContinuation
      continuation = nextContinuation
      if (pageDelayMs > 0) await sleep(pageDelayMs)
    }
    return { logs, lastNextContinuation, finalized }
  }

  async getUserMeasurements(userId: string): Promise<MeasurementsResponse> {
    return this.authedRequest<MeasurementsResponse>(
      'GET',
      userMeasurementsUrl(this.baseUrl, userId),
    )
  }

  async getTemplates(userId: string): Promise<Template[]> {
    const data = await this.authedRequest<{ _embedded?: { template?: Template[] } }>(
      'GET',
      userTemplatesUrl(this.baseUrl, userId),
    )
    return data._embedded?.template ?? []
  }

  /** Raw logs collection endpoint (no include filtering). */
  async getLogsRaw(userId: string): Promise<RawLog[]> {
    const data = await this.authedRequest<{ _embedded?: { log?: RawLog[] } }>(
      'GET',
      logsUrl(this.baseUrl, userId),
    )
    return data._embedded?.log ?? []
  }

  /** Single log detail. */
  async getLog(userId: string, logId: string): Promise<RawLog> {
    return this.authedRequest<RawLog>('GET', userLogUrl(this.baseUrl, userId, logId))
  }
}

/** Compact, JSON-safe preview of a response body for error messages. */
function summarizeBody(text: string): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.length > 300) {
    return `${trimmed.slice(0, 300)}…`
  }
  return trimmed
}
