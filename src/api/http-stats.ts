export type HttpRoute =
  | 'auth-login'
  | 'auth-refresh'
  | 'global-measurements'
  | 'user-log-detail'
  | 'user-measurements'
  | 'user-metadata'
  | 'logs-page'
  | 'unknown'

export interface HttpStatsReport {
  attempts: number
  retries: number
  tokenRefreshes: number
  responseBytes: number
  elapsedMs: number
  routes: Record<string, { attempts: number; statuses: Record<string, number> }>
}

/** Aggregate-only HTTP diagnostics. It intentionally retains no request/response data. */
export class HttpStats {
  private readonly startedAt: number
  private attempts = 0
  private retries = 0
  private tokenRefreshes = 0
  private responseBytes = 0
  private readonly routes = new Map<string, { attempts: number; statuses: Map<string, number> }>()

  constructor(private readonly now: () => number = () => performance.now()) {
    this.startedAt = now()
  }

  recordAttempt(route: HttpRoute, status: number | undefined): void {
    this.attempts++
    const entry = this.routes.get(route) ?? { attempts: 0, statuses: new Map<string, number>() }
    entry.attempts++
    const statusLabel = status === undefined ? 'network_error' : String(status)
    entry.statuses.set(statusLabel, (entry.statuses.get(statusLabel) ?? 0) + 1)
    this.routes.set(route, entry)
  }

  recordResponseBytes(responseBytes: number): void {
    this.responseBytes += responseBytes
  }

  recordRetry(): void {
    this.retries++
  }

  recordTokenRefresh(): void {
    this.tokenRefreshes++
  }

  report(): HttpStatsReport {
    return {
      attempts: this.attempts,
      retries: this.retries,
      tokenRefreshes: this.tokenRefreshes,
      responseBytes: this.responseBytes,
      elapsedMs: Math.round(this.now() - this.startedAt),
      routes: Object.fromEntries(
        [...this.routes.entries()].map(([route, entry]) => [
          route,
          { attempts: entry.attempts, statuses: Object.fromEntries(entry.statuses) },
        ]),
      ),
    }
  }
}

/**
 * Convert a request URL into a fixed, privacy-safe route category. Never add
 * path parameters or query values here: this output is intended for sharing.
 */
export function classifyHttpRoute(url: string): HttpRoute {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname
    if (path === '/auth/login') return 'auth-login'
    if (path === '/auth/login/refresh') return 'auth-refresh'
    if (path === '/api/measurements') return 'global-measurements'
    if (/^\/api\/users\/[^/]+\/logs\/[^/]+$/.test(path)) return 'user-log-detail'
    if (/^\/api\/users\/[^/]+\/measurements$/.test(path)) return 'user-measurements'
    if (/^\/api\/users\/[^/]+$/.test(path)) {
      return parsed.searchParams.getAll('include').includes('log') ? 'logs-page' : 'user-metadata'
    }
    if (/^\/api\/logs\/[^/]+$/.test(path)) return 'logs-page'
  } catch {
    // Diagnostics must never replace the original request failure.
  }
  return 'unknown'
}
