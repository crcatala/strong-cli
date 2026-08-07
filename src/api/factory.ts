/**
 * Builds a StrongClient wired to the current environment + session storage.
 */

import { configFileStore, getEnv, sessionStore } from '../config/config.js'
import { type ClientHeaders, type RetryPolicy, StrongClient } from './client.js'

export interface ClientFactoryOptions {
  /** Use the config-file session store instead of the keyring. */
  useConfig?: boolean
}

/**
 * Fetch implementation injected by `runCli` (tests), falling back to the
 * global fetch for the real CLI. See run.ts (__strongCliFetch).
 */
function injectedFetch(): typeof fetch | undefined {
  return (globalThis as unknown as { __strongCliFetch?: typeof fetch }).__strongCliFetch
}

export function createClient(opts: ClientFactoryOptions = {}): StrongClient {
  const env = getEnv()

  const headers: ClientHeaders = {}
  if (env['STRONG_CLIENT_BUILD']) headers['x-client-build'] = env['STRONG_CLIENT_BUILD']
  if (env['STRONG_CLIENT_PLATFORM']) headers['x-client-platform'] = env['STRONG_CLIENT_PLATFORM']
  if (env['STRONG_USER_AGENT']) headers['user-agent'] = env['STRONG_USER_AGENT']

  // Retry tuning: STRONG_MAX_RETRIES / STRONG_RETRY_BACKOFF_MS, invalid
  // values ignored (defaults from DEFAULT_RETRY_POLICY apply).
  const retry: Partial<RetryPolicy> = {}
  const maxRetries = Number(env['STRONG_MAX_RETRIES'])
  if (Number.isFinite(maxRetries) && maxRetries >= 0) retry.maxRetries = Math.floor(maxRetries)
  const backoffMs = Number(env['STRONG_RETRY_BACKOFF_MS'])
  if (Number.isFinite(backoffMs) && backoffMs > 0) retry.baseDelayMs = backoffMs

  return new StrongClient({
    baseUrl: env['STRONG_BACKEND'],
    store: opts.useConfig ? configFileStore : sessionStore,
    headers,
    fetch: injectedFetch(),
    retry,
  })
}

/** Resolve login credentials from env vars. */
export function credentialsFromEnv(): { username: string; password: string } | null {
  const env = getEnv()
  const username = env['STRONG_USERNAME'] ?? env['STRONG_USER']
  const password = env['STRONG_PASSWORD']
  if (!username || !password) return null
  return { username, password }
}
