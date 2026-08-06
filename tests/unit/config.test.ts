import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TokenState } from '../../src/api/token-manager.js'
import {
  clearSession,
  configFileStore,
  getSessionInfo,
  sessionStore,
  setEnv,
} from '../../src/config/config.js'
import { futureJwt } from '../helpers/fixtures.js'

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
