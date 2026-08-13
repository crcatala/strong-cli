import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../../src/run.js'
import { futureJwt, mockResponse } from '../helpers/fixtures.js'

// ---------------------------------------------------------------------------
// `strong auth login` username resolution.
//
// Regression coverage for the "Missing username" bug: the username must be
// resolved independently of the password, and must fall back to an existing
// stored session (config file / keyring) so re-login works on machines where
// a session is already stored — e.g. a MacBook with an active keyring.
// ---------------------------------------------------------------------------

let tmp: string

function harness(env: Record<string, string | undefined>) {
  const out: string[] = []
  const err: string[] = []
  const stdout = {
    write: (s: string) => {
      out.push(String(s))
      return true
    },
  } as unknown as NodeJS.WritableStream
  const stderr = {
    write: (s: string) => {
      err.push(String(s))
      return true
    },
  } as unknown as NodeJS.WritableStream
  return {
    out,
    err,
    run: (argv: string[], fetchImpl?: typeof fetch) =>
      runCli(argv, { env, stdout, stderr, fetch: fetchImpl }),
  }
}

/** Pre-seed a config-file session (read order: env → config file → keyring). */
function seedConfigSession(username: string): void {
  const dir = join(tmp, 'strong-cli')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify(
      {
        accessToken: futureJwt(),
        refreshToken: 'rt',
        userId: 'user-1',
        expiresAt: Date.now() + 1_200_000,
        username,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}

/** Captures the POST /auth/login body so tests can assert what was sent. */
function loginFetch() {
  const bodies: Array<{ usernameOrEmail: string; password: string }> = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/auth/login')) {
      bodies.push(JSON.parse(String(init?.body)) as { usernameOrEmail: string; password: string })
      return mockResponse({
        accessToken: futureJwt(),
        refreshToken: 'rt-new',
        expiresIn: 1200,
        userId: 'user-1',
      })
    }
    throw new Error(`Unexpected fetch call: ${url}`)
  })
  return { bodies, fetchImpl }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-auth-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('auth login username resolution', () => {
  it('falls back to the stored session username (re-login on an already-configured machine)', async () => {
    // Keyring-active machine scenario: a session with a username already
    // exists; the user re-runs `strong auth login` (e.g. after a password
    // change) without a --username flag or STRONG_USERNAME.
    seedConfigSession('stored-user')
    const { bodies, fetchImpl } = loginFetch()
    const h = harness({ XDG_CONFIG_HOME: tmp, STRONG_PASSWORD: 'pw' })

    await h.run(['auth', 'login', '--plain'], fetchImpl)

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ usernameOrEmail: 'stored-user', password: 'pw' })
    expect(h.out.join('')).toContain('Logged in as stored-user')
  })

  it('prefers env username over the stored session, independently of the password', async () => {
    seedConfigSession('stored-user')
    const { bodies, fetchImpl } = loginFetch()
    const h = harness({
      XDG_CONFIG_HOME: tmp,
      STRONG_USERNAME: 'env-user',
      STRONG_PASSWORD: 'env-pw',
    })

    await h.run(['auth', 'login'], fetchImpl)

    expect(bodies[0]).toMatchObject({ usernameOrEmail: 'env-user', password: 'env-pw' })
  })

  it('still fails with a clear error when no username is available anywhere (headless)', async () => {
    // No stored session, no env username, non-TTY stdin → no interactive
    // prompt, so this must keep the explicit error rather than hanging.
    const { fetchImpl } = loginFetch()
    const h = harness({ XDG_CONFIG_HOME: tmp })

    await expect(h.run(['auth', 'login'], fetchImpl)).rejects.toThrow(/Missing username/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
