import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import { UsageError } from '../../src/cli/errors.js'
import { resetEnv } from '../../src/config/config.js'
import { runCli } from '../../src/run.js'
import { memStore } from './mem-store.js'
import { createRateLimitedFetch } from './rate-limit.js'

const RUN_LIVE = process.env.RUN_LIVE_TESTS === '1'
const delayMs = Number.parseInt(process.env.STRONG_LIVE_DELAY_MS ?? '300', 10)
const rateLimitedFetch = createRateLimitedFetch(
  globalThis.fetch.bind(globalThis),
  Number.isFinite(delayMs) ? Math.max(100, delayMs) : 300,
)

type Output = {
  out: string[]
  err: string[]
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
}

function output(): Output {
  const out: string[] = []
  const err: string[] = []
  const stdout = {
    write: (chunk: string) => {
      out.push(String(chunk))
      return true
    },
  } as never
  const stderr = {
    write: (chunk: string) => {
      err.push(String(chunk))
      return true
    },
  } as never
  return { out, err, stdout, stderr }
}

describe.skipIf(!RUN_LIVE)('live: CLI smoke', () => {
  it('runs auth status, measurements, and workouts through the CLI parser', async () => {
    const username = process.env.STRONG_USERNAME ?? process.env.STRONG_USER
    const password = process.env.STRONG_PASSWORD
    if (!username || !password) {
      throw new Error('CLI live tests require STRONG_USERNAME/STRONG_PASSWORD')
    }

    const client = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: memStore(),
      fetch: rateLimitedFetch,
    })
    const session = await client.login(username, password)
    const env = {
      XDG_CONFIG_HOME: join(tmpdir(), `strong-cli-live-cli-${Date.now()}`),
      STRONG_ACCESS_TOKEN: session.accessToken,
      STRONG_REFRESH_TOKEN: session.refreshToken,
      STRONG_USER_ID: session.userId,
      STRONG_TOKEN_EXPIRES_AT: String(session.expiresAt),
      STRONG_FORMAT: 'json',
    }

    try {
      const status = output()
      await runCli(['auth', 'status', '--json'], { env, ...status, fetch: rateLimitedFetch })
      expect(JSON.parse(status.out.join(''))).toMatchObject({
        authenticated: true,
        userId: session.userId,
      })

      const measurements = output()
      await runCli(['measurements', '--json'], { env, ...measurements, fetch: rateLimitedFetch })
      expect(Array.isArray(JSON.parse(measurements.out.join('')))).toBe(true)

      const workouts = output()
      await runCli(['workouts', '--limit', '1', '--json'], {
        env,
        ...workouts,
        fetch: rateLimitedFetch,
      })
      expect(Array.isArray(JSON.parse(workouts.out.join('')))).toBe(true)

      await expect(
        runCli(['measurements', 'add', 'WEIGHT', '180'], {
          env,
          ...output(),
          fetch: rateLimitedFetch,
        }),
      ).rejects.toBeInstanceOf(UsageError)
    } finally {
      resetEnv()
    }
  }, 180_000)
})
