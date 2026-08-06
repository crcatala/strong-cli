import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenState } from '../../src/api/token-manager.js'
import {
  clearSession,
  configFileStore,
  getSessionInfo,
  sessionStore,
  setEnv,
} from '../../src/config/config.js'
import { futureJwt } from '../helpers/fixtures.js'

// ---------------------------------------------------------------------------
// keytar mock — in-memory keyring so the default `auth login` path (system
// keyring) is covered without touching a real OS keychain.
// ---------------------------------------------------------------------------
const { keyringMap, keyringMock } = vi.hoisted(() => {
  const keyringMap = new Map<string, string>()
  return {
    keyringMap,
    keyringMock: {
      getPassword: vi.fn(async (_service: string, account: string) => {
        return keyringMap.get(account) ?? null
      }),
      setPassword: vi.fn(async (_service: string, account: string, value: string) => {
        keyringMap.set(account, value)
      }),
      deletePassword: vi.fn(async (_service: string, account: string) => {
        keyringMap.delete(account)
        return true
      }),
    },
  }
})

vi.mock('keytar', () => ({
  default: {
    getPassword: keyringMock.getPassword,
    setPassword: keyringMock.setPassword,
    deletePassword: keyringMock.deletePassword,
  },
}))

// A (fake) session bus claims the keyring is reachable so the keytar paths
// actually run even on headless Linux test runners.
const withSessionBus = (overrides: Record<string, string | undefined> = {}) => ({
  XDG_CONFIG_HOME: tmp,
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/fake-bus',
  ...overrides,
})

let tmp: string

function state(): TokenState {
  return {
    accessToken: futureJwt(),
    refreshToken: 'rt',
    userId: 'user-1',
    deviceId: 'dev-1',
    expiresAt: Date.now() + 1200_000,
    username: 'test-user',
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-test-'))
  setEnv({ XDG_CONFIG_HOME: tmp })
})

afterEach(() => {
  setEnv({})
  rmSync(tmp, { recursive: true, force: true })
})

describe('config file store', () => {
  it('writes and reads a session', async () => {
    await configFileStore.write(state())
    const read = await configFileStore.read()
    expect(read?.userId).toBe('user-1')
    expect(read?.username).toBe('test-user')
  })

  it('returns null when no session exists', async () => {
    expect(await configFileStore.read()).toBeNull()
  })

  it('getSessionInfo reports the config-file source', async () => {
    await configFileStore.write(state())
    const info = await getSessionInfo()
    expect(info.storage).toBe('config')
    expect(info.state?.deviceId).toBe('dev-1')
  })

  it('clearSession removes the session file', async () => {
    await configFileStore.write(state())
    expect(existsSync(join(tmp, 'strong-cli', 'session.json'))).toBe(true)
    await clearSession()
    expect(existsSync(join(tmp, 'strong-cli', 'session.json'))).toBe(false)
  })

  it('sessionStore prefers a config-file session over the keyring', async () => {
    await configFileStore.write(state())
    const read = await sessionStore.read()
    expect(read?.userId).toBe('user-1')
    expect(read?.username).toBe('test-user')
  })

  it('sessionStore.write mirrors the config-file source (rotation stays headless-safe)', async () => {
    await configFileStore.write(state())
    const rotated = { ...state(), refreshToken: 'rotated-rt' }
    await sessionStore.write(rotated)
    const read = await sessionStore.read()
    expect(read?.refreshToken).toBe('rotated-rt')
  })
})

describe('env-sourced sessions', () => {
  it('reads from STRONG_ACCESS_TOKEN with priority over stored sessions', async () => {
    await configFileStore.write(state())
    setEnv({
      XDG_CONFIG_HOME: tmp,
      STRONG_ACCESS_TOKEN: futureJwt(),
      STRONG_REFRESH_TOKEN: 'env-rt',
      STRONG_USERNAME: 'env-user',
    })
    const info = await getSessionInfo()
    expect(info.storage).toBe('env')
    expect(info.state?.refreshToken).toBe('env-rt')
    expect(info.state?.username).toBe('env-user')
  })

  it('sessionStore refuses to overwrite env-sourced credentials', async () => {
    setEnv({
      XDG_CONFIG_HOME: tmp,
      STRONG_ACCESS_TOKEN: futureJwt(),
    })
    await expect(sessionStore.write(state())).rejects.toThrow(/STRONG_ACCESS_TOKEN/)
  })
})

describe('keyring store (default auth path)', () => {
  beforeEach(() => {
    keyringMap.clear()
    keyringMock.getPassword.mockClear()
    keyringMock.setPassword.mockClear()
    keyringMock.deletePassword.mockClear()
  })

  it('writes a session to the keyring and reads it back', async () => {
    setEnv(withSessionBus())
    await sessionStore.write(state())
    expect(keyringMock.setPassword).toHaveBeenCalledWith(
      'strong-cli',
      'session',
      expect.any(String),
    )
    expect(await sessionStore.read()).toMatchObject({ userId: 'user-1', username: 'test-user' })
  })

  it('getSessionInfo reports the keyring source', async () => {
    setEnv(withSessionBus())
    await sessionStore.write(state())
    const info = await getSessionInfo()
    expect(info.storage).toBe('keyring')
    expect(info.state?.deviceId).toBe('dev-1')
  })

  it('clearSession removes the keyring entry', async () => {
    setEnv(withSessionBus())
    await sessionStore.write(state())
    await clearSession()
    expect(keyringMock.deletePassword).toHaveBeenCalledWith('strong-cli', 'session')
    expect(await sessionStore.read()).toBeNull()
  })

  it('surfaces a friendly error when the keyring write fails', async () => {
    setEnv(withSessionBus())
    keyringMock.setPassword.mockRejectedValueOnce(new Error('secret service vanished'))
    await expect(sessionStore.write(state())).rejects.toThrow(/Unable to store credentials/)
  })

  it('returns null when the keyring read fails', async () => {
    setEnv(withSessionBus())
    keyringMock.getPassword.mockRejectedValueOnce(new Error('busy'))
    expect(await sessionStore.read()).toBeNull()
  })

  it.skipIf(process.platform !== 'linux')(
    'headless Linux without a session bus falls back and refuses to write',
    async () => {
      setEnv({ XDG_CONFIG_HOME: tmp })
      expect(await sessionStore.read()).toBeNull()
      await expect(sessionStore.write(state())).rejects.toThrow(/No system keyring available/)
    },
  )
})
