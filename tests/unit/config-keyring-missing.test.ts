import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenState } from '../../src/api/token-manager.js'
import { getSessionInfo, sessionStore, setEnv } from '../../src/config/config.js'
import { futureJwt } from '../helpers/fixtures.js'

// Simulate a machine where keytar is not installed at all (the
// optionalDependency failed to build). `getKeytar()` must degrade
// gracefully: reads fall back to null, writes surface a clear error.
vi.mock('keytar', () => ({ default: null }))

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
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-nokeytar-'))
  // Claim a session bus so the keyring guards don't short-circuit before
  // the (missing) keytar module is reached.
  setEnv({ XDG_CONFIG_HOME: tmp, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/fake' })
})

afterEach(() => {
  setEnv({})
  rmSync(tmp, { recursive: true, force: true })
})

describe('keyring store without keytar installed', () => {
  it('reads fall back to null silently', async () => {
    expect(await sessionStore.read()).toBeNull()
    expect(await getSessionInfo()).toEqual({ storage: null, state: null })
  })

  it('writes fail with a clear error', async () => {
    await expect(sessionStore.write(state())).rejects.toThrow(/keytar unavailable/)
  })
})
