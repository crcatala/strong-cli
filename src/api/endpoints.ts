/**
 * Endpoint map for the Strong backend.
 *
 * Base URL: https://back.strong.app (discoverable from the iOS/Android app;
 * also appears as the `iss`/`aud` claim of the login JWT and in public
 * client implementations such as tolik518/strong-api-workout-sync,
 * jerhinesmith/strong-mcp, TheAlexLichter/strong-exporter).
 */

export const STRONG_BACKEND_DEFAULT = 'https://back.strong.app'

/** Client fingerprint sent with every request (Android build verified live 2026-03). */
export const CLIENT_HEADERS_DEFAULT = {
  'user-agent': 'Strong Android',
  accept: 'application/json',
  'x-client-build': '600013',
  'x-client-platform': 'android',
} as const

export const JWT_NAME_IDENTIFIER_CLAIM =
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

export function loginUrl(base: string): string {
  return `${base}/auth/login`
}

export function refreshUrl(base: string): string {
  return `${base}/auth/login/refresh`
}

export function userUrl(
  base: string,
  userId: string,
  opts: { limit?: number; continuation?: string; includes?: string[] } = {},
): string {
  const url = new URL(`${base}/api/users/${userId}`)
  if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit))
  // The API expects the continuation parameter to be present (even empty on
  // the first page) — verified against tolik518/strong-api-workout-sync and
  // TheAlexLichter/strong-exporter. Omitting it can return HTTP 400.
  url.searchParams.set('continuation', opts.continuation ?? '')
  for (const include of opts.includes ?? []) {
    url.searchParams.append('include', include)
  }
  return url.toString()
}

/**
 * Write-path URL for the user doc (envelope PUT). No query params — the
 * write protocol is a whole-document sync, and the GET-only `continuation`
 * param is meaningless here (verified against strong-mcp).
 */
export function userWriteUrl(base: string, userId: string): string {
  return `${base}/api/users/${userId}`
}

export function measurementsUrl(base: string, page: number): string {
  const url = new URL(`${base}/api/measurements`)
  url.searchParams.set('page', String(page))
  return url.toString()
}

export function userMeasurementsUrl(base: string, userId: string): string {
  return `${base}/api/users/${userId}/measurements`
}

export function userTemplatesUrl(base: string, userId: string): string {
  return `${base}/api/users/${userId}/templates`
}

export function logsUrl(base: string, userId: string): string {
  return `${base}/api/logs/${userId}`
}

export function userLogUrl(base: string, userId: string, logId: string): string {
  return `${base}/api/users/${userId}/logs/${logId}`
}
