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
  userUrl,
  userWriteUrl,
} from './endpoints.js'
import { TokenManager, type TokenState, type TokenStore } from './token-manager.js'
import type {
  Folder,
  LoginRequest,
  LoginResponse,
  MeasurementsResponse,
  RawLog,
  RefreshRequest,
  Tag,
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
  /** Override the retry policy (defaults to {@link DEFAULT_RETRY_POLICY}). */
  retry?: Partial<RetryPolicy>
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

/**
 * Retry policy for transient failures (5xx, 429 rate limits) on authed
 * requests. Env-tunable via STRONG_MAX_RETRIES / STRONG_RETRY_BACKOFF_MS
 * (see `factory.ts`). Delays are `baseDelayMs × attempt`, jittered ±25% to
 * avoid synchronized retry storms.
 */
export interface RetryPolicy {
  /** Max retries per request for retryable statuses (5xx, 429). */
  maxRetries: number
  /** Base backoff in ms (per-attempt delay = base × attempt, jittered). */
  baseDelayMs: number
  /** Whether 429 (soft rate limit) is retried with backoff. */
  retryRateLimited: boolean
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 250,
  retryRateLimited: true,
}

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

/** Options for a generic user-doc page walk (see {@link StrongClient.walkUserPages}). */
export interface UserPageWalkOptions {
  /** Embedded collections to fetch per page (e.g. `['log']`, `['template']`). */
  includes?: string[]
  /** Resume token; `''`/omitted = start from the first page. */
  continuation?: string
  /** Per-page size (default 200). */
  limit?: number
  /** Override the per-walk page cap (default {@link DEFAULT_MAX_PAGES}). */
  maxPages?: number
  /** Override the inter-page delay in ms (default {@link DEFAULT_PAGE_DELAY_MS}). */
  pageDelayMs?: number
}

/**
 * Result of a generic user-doc walk (see {@link StrongClient.walkUserPages}).
 * `lastNextContinuation` semantics match {@link LogsWalk}.
 */
export interface UserPagesWalk {
  /** Every fetched page, in order. */
  pages: UserResponse[]
  /** Token to resume the next walk from; `''` = start from the first page. */
  lastNextContinuation: string
  /** True when the walk reached the end of the stream (no more `next` links). */
  finalized: boolean
}

/**
 * HTTP client for the undocumented Strong backend (https://back.strong.app).
 *
 * Handles: auth (login + token refresh via TokenManager), HAL response
 * unwrapping, 401-retry-once-after-refresh, and retryable-status backoff
 * (5xx + 429 rate limits; see {@link RetryPolicy}).
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
   * Authed request with 401-retry-once-after-refresh and retryable-status
   * backoff (5xx + 429 rate limits; see {@link RetryPolicy}).
   */
  private async authedRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<T> {
    const retry = { ...DEFAULT_RETRY_POLICY, ...this.opts.retry }
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
        const retryable =
          (status !== undefined && status >= 500) || (status === 429 && retry.retryRateLimited)
        if (retryable && attempt < retry.maxRetries) {
          attempt++
          // Jittered backoff (±25%) — a deterministic sleep would let
          // concurrent requests re-collide on the rate limiter.
          await sleep(retry.baseDelayMs * attempt * (0.75 + Math.random() * 0.5))
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
    const { pages, lastNextContinuation, finalized } = await this.walkUserPages(userId, {
      includes: ['log'],
      ...walk,
    })
    const logs = pages.flatMap((p) => p._embedded?.log ?? [])
    return { logs, lastNextContinuation, finalized }
  }

  /**
   * Generic user-doc walk: fetch `includes` collections page by page, following
   * `_links.next` continuation pagination (shared implementation behind
   * {@link walkLogs} and {@link getTemplates}).
   *
   * Same safety guards as {@link walkLogs}: page cap, self-referencing-loop
   * detection, and inter-page pacing. A page counts as exhausted when it
   * carries no entities in any of the requested collections.
   */
  async walkUserPages(userId: string, walk: UserPageWalkOptions = {}): Promise<UserPagesWalk> {
    const includes = walk.includes ?? []
    const limit = walk.limit ?? 200
    const maxPages = walk.maxPages ?? DEFAULT_MAX_PAGES
    const pageDelayMs = walk.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
    const pages: UserResponse[] = []
    const seenContinuations = new Set<string>()
    let continuation = walk.continuation ?? ''
    let lastNextContinuation = ''
    let finalized = false
    for (let page = 0; ; page++) {
      if (page >= maxPages) {
        throw new ApiError(
          `Paginated user-doc walk hit the ${maxPages}-page safety cap — aborting instead of following ` +
            'more pagination links (raise maxPages if this is a real, enormous history)',
        )
      }
      const user = await this.getUser(userId, { limit, continuation, includes })
      pages.push(user)

      const next = user._links?.next
      if (
        !next ||
        typeof next !== 'object' ||
        !('href' in next) ||
        pageHasNoEntities(user, includes)
      ) {
        // End of stream: nothing more to follow (empty pages are treated as
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
          `Pagination loop detected in user-doc walk: continuation token repeated after ${page + 1} ` +
            'page(s) — refusing to keep following a self-referencing next link',
        )
      }
      seenContinuations.add(nextContinuation)
      lastNextContinuation = nextContinuation
      continuation = nextContinuation
      if (pageDelayMs > 0) await sleep(pageDelayMs)
    }
    return { pages, lastNextContinuation, finalized }
  }

  async getUserMeasurements(userId: string): Promise<MeasurementsResponse> {
    return this.authedRequest<MeasurementsResponse>(
      'GET',
      userMeasurementsUrl(this.baseUrl, userId),
    )
  }

  /**
   * Routine templates, following `_links.next` continuation pagination via the
   * user doc (`include=template` — same verified pattern as tags/folders).
   * Fixes the old single-page fetch (sc-sfn8): accounts with many templates
   * no longer see a truncated list.
   */
  async getTemplates(userId: string, opts: PaginationOptions = {}): Promise<Template[]> {
    const { pages } = await this.walkUserPages(userId, { includes: ['template'], ...opts })
    return pages.flatMap((p) => p._embedded?.template ?? [])
  }

  /**
   * Exercise tags from the user doc (`include=tag`). Shape verified live:
   * `{ id, name: {en}, color, isGlobal, _links.measurement[] }`. Small
   * collection — a single page covers typical accounts.
   */
  async getTags(userId: string): Promise<Tag[]> {
    const data = await this.getUser(userId, { includes: ['tag'] })
    return data._embedded?.tag ?? []
  }

  /**
   * Template folders from the user doc (`include=folder`). Shape verified
   * live: `{ id, name: {en}, index, isGlobal, _links.template[] }`.
   */
  async getFolders(userId: string): Promise<Folder[]> {
    const data = await this.getUser(userId, { includes: ['folder'] })
    return data._embedded?.folder ?? []
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

  /**
   * Write path — PUT a change envelope to the user doc (docs/api-inventory.md).
   *
   * The envelope carries only the changed entities ({id, strongAnalytics:false,
   * _embedded: {<collection>: [changed entities]}}); unchanged collections are
   * sent as empty arrays. This is the client's only mutation method — callers
   * opt in explicitly; the default posture of this library stays read-only.
   */
  async putEnvelope(
    userId: string,
    envelope: { id: string; strongAnalytics: false; _embedded: Record<string, unknown[]> },
  ): Promise<void> {
    await this.authedRequest('PUT', userWriteUrl(this.baseUrl, userId), envelope)
  }
}

/** True when none of the requested collections carried entities on this page. */
function pageHasNoEntities(user: UserResponse, includes: string[]): boolean {
  const embedded = user._embedded ?? {}
  return includes.every((collection) => {
    const entities = embedded[collection]
    return !Array.isArray(entities) || entities.length === 0
  })
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
