import { JWT_NAME_IDENTIFIER_CLAIM } from './endpoints.js'

export interface DecodedJwt {
  /** Strong user id, from the WS-Federation nameidentifier claim. */
  userId?: string
  /** Expiry as epoch milliseconds. */
  expMs: number
}

/**
 * Decode a Strong access token (JWT, HS256) and extract the claims we care
 * about. We never verify the signature — the token came from our own login
 * response over TLS — we only need `exp` for proactive refresh timing.
 *
 * Accepted threat model (documented decision, sc-2aab): no signature
 * verification and no sanity checks on `exp` bounds / `iat` / `nbf`. The
 * token always originates from our own TLS login response, so a forged token
 * would require already owning the session; the tool is a personal read-only
 * CLI and never imports third-party session files. Revisit if the tool is
 * ever shared or fed external session data — at minimum validate that `exp`
 * is a plausible future timestamp and that `iat`/`nbf` are not in the
 * future; full signature verification is likely infeasible without the real
 * signing key.
 */
export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed JWT: expected three dot-separated segments')
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('Malformed JWT: could not decode payload')
  }

  const exp = payload.exp
  if (typeof exp !== 'number') {
    throw new Error('Malformed JWT: missing exp claim')
  }

  const userId = payload[JWT_NAME_IDENTIFIER_CLAIM]
  return {
    userId: typeof userId === 'string' ? userId : undefined,
    expMs: exp * 1000,
  }
}
