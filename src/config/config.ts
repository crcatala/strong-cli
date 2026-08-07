/**
 * Session storage for strong-cli.
 *
 * A session is a small JSON document:
 *   { accessToken, refreshToken, userId, deviceId, expiresAt, username }
 *
 * Storage backends (first match wins on read):
 *   1. STRONG_ACCESS_TOKEN / STRONG_REFRESH_TOKEN env vars  (headless/CI)
 *   2. system keyring (via keytar, macOS Keychain / Windows Credential
 *      Manager / Linux Secret Service) — default for `auth login`
 *   3. plaintext session.json in the config dir (0600) — `--use-config`
 *
 * Config dir follows OS conventions:
 *   $XDG_CONFIG_HOME/strong-cli (Linux) · ~/Library/Application Support/
 *   strong-cli (macOS) · %LOCALAPPDATA%/strong-cli (Windows)
 *
 * Env injection contract: config reads env through a module-global snapshot
 * (`setEnv`, used by run.ts at bootstrap and by tests). That state is
 * process-global, so any test calling `setEnv` MUST restore it in
 * `afterEach` — use `resetEnv()` (or setEnv back) to avoid leaking a fake
 * environment into sibling tests. See config.test.ts for the pattern.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import type { TokenState, TokenStore } from '../api/token-manager.js'

const SERVICE_NAME = 'strong-cli'
const ACCOUNT_NAME = 'session'
const SESSION_FILENAME = 'session.json'

let _env: Record<string, string | undefined> = { ...process.env }

/**
 * Override the environment used by config (tests + run.ts injection).
 * Takes a snapshot — later mutations of the passed object do not leak in.
 */
export function setEnv(env: Record<string, string | undefined>): void {
  _env = { ...env }
}

/**
 * Restore the real process environment. Tests that call `setEnv` must reset
 * here in `afterEach` — the snapshot is module-global (see the docstring).
 */
export function resetEnv(): void {
  _env = { ...process.env }
}

/** Current injected environment. */
export function getEnv(): Record<string, string | undefined> {
  return _env
}

export function getConfigDir(): string {
  const xdg = _env['XDG_CONFIG_HOME']
  if (xdg) return join(xdg, 'strong-cli')
  const plat = platform()
  if (plat === 'darwin') return join(homedir(), 'Library', 'Application Support', 'strong-cli')
  if (plat === 'win32') {
    const local = _env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    return join(local, 'strong-cli')
  }
  return join(homedir(), '.config', 'strong-cli')
}

export function getSessionFilePath(): string {
  return join(getConfigDir(), SESSION_FILENAME)
}

function ensureConfigDir(): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

function readSessionFile(): TokenState | null {
  const file = getSessionFilePath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as TokenState
  } catch {
    return null
  }
}

function writeSessionFile(state: TokenState): void {
  ensureConfigDir()
  const file = getSessionFilePath()
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 })
  chmodSync(file, 0o600)
}

// ---------------------------------------------------------------------------
// keytar (lazy)
// ---------------------------------------------------------------------------

async function getKeytar() {
  try {
    const keytar = await import('keytar')
    return keytar.default
  } catch {
    return null
  }
}

/**
 * Heuristic: is a system keyring (Secret Service / D-Bus) reachable?
 * On headless Linux there is often no session bus, and libsecret prints
 * "Cannot autolaunch D-Bus without X11 $DISPLAY" then fails. Guarding on a
 * session bus lets us skip keytar entirely (no import, no noise) and fall
 * back to the config file.
 */
function hasSessionBus(): boolean {
  if (platform() !== 'linux') return true
  if (_env['DBUS_SESSION_BUS_ADDRESS']) return true
  const runtime = _env['XDG_RUNTIME_DIR']
  if (runtime) {
    try {
      return existsSync(join(runtime, 'bus'))
    } catch {
      return false
    }
  }
  return false
}

async function readKeyring(): Promise<TokenState | null> {
  if (!hasSessionBus()) return null
  const keytar = await getKeytar()
  if (!keytar) return null
  try {
    const raw = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
    return raw ? (JSON.parse(raw) as TokenState) : null
  } catch {
    return null
  }
}

async function writeKeyring(state: TokenState): Promise<void> {
  if (!hasSessionBus()) {
    throw new Error(
      'No system keyring available (headless Linux without a D-Bus session bus). ' +
        'Use `--use-config` to store the session in a config file instead.',
    )
  }
  const keytar = await getKeytar()
  if (!keytar) throw new Error('keytar unavailable — install libsecret or use --use-config')
  try {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(state))
  } catch (err) {
    throw new Error(
      `Unable to store credentials in the system keyring (${err instanceof Error ? err.message : String(err)}). ` +
        'On Linux install libsecret-1-dev, or use --use-config.',
    )
  }
}

async function deleteKeyring(): Promise<void> {
  if (!hasSessionBus()) return
  const keytar = await getKeytar()
  if (!keytar) return
  try {
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
  } catch {
    // not present
  }
}

// ---------------------------------------------------------------------------
// Store implementations
// ---------------------------------------------------------------------------

export type SessionStorage = 'env' | 'keyring' | 'config'

export interface SessionInfo {
  storage: SessionStorage | null
  state: TokenState | null
}

/** Resolve a session from env vars (highest priority). */
function sessionFromEnv(): TokenState | null {
  const accessToken = _env['STRONG_ACCESS_TOKEN']
  const refreshToken = _env['STRONG_REFRESH_TOKEN']
  const userId = _env['STRONG_USER_ID']
  if (!accessToken) return null
  return {
    accessToken,
    refreshToken: refreshToken ?? '',
    userId: userId ?? 'unknown',
    deviceId: _env['STRONG_DEVICE_ID'],
    expiresAt: Number(_env['STRONG_TOKEN_EXPIRES_AT'] ?? 0),
    username: _env['STRONG_USERNAME'] ?? _env['STRONG_USER'],
  }
}

/**
 * Source-aware store used by all read commands.
 *
 * Read order: env vars → config file → keyring. Config-file sessions
 * (created with `--use-config`) take precedence over the keyring because
 * they were the user's explicit choice and work on headless machines.
 *
 * Write mirrors the existing session's source so token rotation lands
 * where the session already lives — a `--use-config` session never touches
 * the keyring (which fails without a D-Bus session bus on headless Linux).
 */
export const sessionStore: TokenStore = {
  async read(): Promise<TokenState | null> {
    const fromEnv = sessionFromEnv()
    if (fromEnv) return fromEnv
    const file = readSessionFile()
    if (file) return file
    return readKeyring()
  },
  async write(state: TokenState): Promise<void> {
    // Never write over env-provided credentials.
    if (_env['STRONG_ACCESS_TOKEN']) {
      throw new Error(
        'STRONG_ACCESS_TOKEN is set in the environment — refusing to overwrite env-sourced credentials. Unset it to persist a session.',
      )
    }
    // Mirror the storage source of the existing session (if any).
    const file = readSessionFile()
    if (file) {
      writeSessionFile(state)
      return
    }
    await writeKeyring(state)
  },
}

/** Config-file store (--use-config). */
export const configFileStore: TokenStore = {
  read: () => Promise.resolve(readSessionFile()),
  write: (state) => Promise.resolve(writeSessionFile(state)),
}

/** Clear the session from wherever it lives. */
export async function clearSession(): Promise<void> {
  await deleteKeyring()
  const file = getSessionFilePath()
  if (existsSync(file)) {
    try {
      unlinkSync(file)
    } catch {
      // best effort
    }
  }
}

export async function getSessionInfo(): Promise<SessionInfo> {
  if (sessionFromEnv()) return { storage: 'env', state: sessionFromEnv() }
  const file = readSessionFile()
  if (file) return { storage: 'config', state: file }
  const keyring = await readKeyring()
  if (keyring) return { storage: 'keyring', state: keyring }
  return { storage: null, state: null }
}

export function formatExpiry(expiresAt: number): string {
  if (!expiresAt) return 'unknown'
  return new Date(expiresAt).toISOString()
}
