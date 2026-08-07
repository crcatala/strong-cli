import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../../src/run.js'
import {
  createFetchMock,
  futureJwt,
  MEASUREMENT_IDS,
  mockResponse,
  syntheticLog,
  syntheticUserResponse,
} from '../helpers/fixtures.js'

let tmp: string

function tokenEnv(xdg: string): Record<string, string | undefined> {
  return {
    XDG_CONFIG_HOME: xdg,
    STRONG_ACCESS_TOKEN: futureJwt(3600, 'user-1'),
    STRONG_REFRESH_TOKEN: 'rt-1',
    STRONG_USER_ID: 'user-1',
    STRONG_TOKEN_EXPIRES_AT: String(Date.now() + 3_600_000),
    STRONG_USERNAME: 'test-user',
  }
}

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

const globalMeasurements = [
  { id: MEASUREMENT_IDS.squatMachine, name: { en: 'Squat (Machine)' } },
  { id: MEASUREMENT_IDS.uprightRowDumbbell, name: { en: 'Upright Row (Dumbbell)' } },
]

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-cmd-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('workout <id> command', () => {
  it('fetches the single log via the detail endpoint (no full-history pagination)', async () => {
    const urls: string[] = []
    const inner = createFetchMock([
      {
        match: (url) => url.includes('/auth/login/refresh'),
        handler: () =>
          mockResponse({ accessToken: futureJwt(1200), refreshToken: 'rt-2', expiresIn: 1200 }),
      },
      {
        match: (url) => url.includes('/logs/log-0001'),
        handler: () => mockResponse(syntheticLog()),
      },
      {
        match: (url) => url.includes('include=measurement'),
        handler: () => mockResponse(syntheticUserResponse([])),
      },
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () => mockResponse({ _embedded: { measurement: globalMeasurements } }),
      },
    ])
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input))
      return inner(input, init)
    })

    const h = harness(tokenEnv(tmp))
    await h.run(['workout', 'log-0001', '--json'], fetchImpl)

    const out = h.out.join('')
    expect(out).toContain('"id": "log-0001"')
    expect(out).toContain('Squat (Machine)')
    expect(out).toContain('Upright Row (Dumbbell)')
    expect(out).toContain('"name": "Leg Day"')

    // The detail path must hit the single-log endpoint and never paginate
    // the whole workout history (include=log).
    expect(urls.some((u) => u.includes('/logs/log-0001'))).toBe(true)
    expect(urls.some((u) => u.includes('include=log'))).toBe(false)
  })

  it('--unit overrides weight and distance display units', async () => {
    const fetchImpl = createFetchMock([
      {
        match: (url) => url.includes('/auth/login/refresh'),
        handler: () =>
          mockResponse({ accessToken: futureJwt(1200), refreshToken: 'rt-2', expiresIn: 1200 }),
      },
      {
        match: (url) => url.includes('/logs/log-0001'),
        handler: () => mockResponse(syntheticLog()),
      },
      {
        match: (url) => url.includes('include=measurement'),
        handler: () => mockResponse(syntheticUserResponse([])),
      },
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () => mockResponse({ _embedded: { measurement: globalMeasurements } }),
      },
    ])

    const h = harness(tokenEnv(tmp))
    // Account prefs are KILOGRAMS; --unit lb must win for display.
    await h.run(['workout', 'log-0001', '--plain', '--unit', 'lb'], fetchImpl)

    const out = h.out.join('')
    expect(out).toContain('lb')
    expect(out).toContain('132.28') // 60 kg ≈ 132.28 lb
    expect(out).not.toContain('kg')
  })

  it('reports a missing workout as not found instead of an error', async () => {
    const fetchImpl = createFetchMock([
      {
        match: (url) => url.includes('/auth/login/refresh'),
        handler: () =>
          mockResponse({ accessToken: futureJwt(1200), refreshToken: 'rt-2', expiresIn: 1200 }),
      },
      {
        match: () => true,
        handler: () => mockResponse({ title: 'Not Found' }, { status: 404 }),
      },
    ])

    const h = harness(tokenEnv(tmp))
    await h.run(['workout', 'no-such-log', '--plain'], fetchImpl)

    const out = h.out.join('')
    expect(out).toContain('not found')
    expect(out).toContain('no-such-log')
  })
})

describe('auth whoami', () => {
  it('resolves as an alias of auth status', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['auth', 'whoami'])

    const out = h.out.join('')
    expect(out).toContain('"authenticated": true')
    expect(out).toContain('"userId": "user-1"')
    expect(out).toContain('"source": "env"')
  })
})

describe('workouts list command', () => {
  function listFetch() {
    const log = syntheticLog() // id 'log-0001'
    return createFetchMock([
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () => mockResponse({ _embedded: { measurement: globalMeasurements } }),
      },
      {
        match: (url) => url.includes('include=measurement'),
        handler: () => mockResponse(syntheticUserResponse([])),
      },
      {
        match: (url) => url.includes('include=log'),
        handler: () => mockResponse(syntheticUserResponse([log])),
      },
    ])
  }

  it('shows the workout id in plain output so it can be passed to workout <id>', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['workouts', '--plain', '--limit', '5'], listFetch())

    const out = h.out.join('')
    expect(out).toContain('log-0001')
    expect(out).toContain('Leg Day')
  })

  it('shows the workout id in table output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['workouts', '--table', '--limit', '5'], listFetch())

    const out = h.out.join('')
    expect(out).toContain('ID')
    expect(out).toContain('log-0001')
  })

  it('defaults to POUNDS when no account pref matches the session user', async () => {
    // syntheticUserResponse prefs are keyed to 'test-user-123' but the env
    // session uses 'user-1', so the lookup misses and display falls back to lb.
    const h = harness(tokenEnv(tmp))
    await h.run(['workouts', '--plain', '--limit', '5'], listFetch())

    const out = h.out.join('')
    expect(out).toContain('4,156 lb') // 1885 kg·reps ≈ 4155.7 lb
  })

  it('--unit kg overrides the default display unit', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['workouts', '--plain', '--limit', '5', '--unit', 'kg'], listFetch())

    const out = h.out.join('')
    expect(out).toContain('1,885 kg') // 60×12 + 70×10 + 20×12 + 22.5×10 kg·reps
    expect(out).not.toContain('lb')
  })

  it('--unit overrides the account preference for display only', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['workouts', '--plain', '--limit', '5', '--unit', 'lb'], listFetch())

    const out = h.out.join('')
    expect(out).toContain('lb')
    expect(out).toContain('4,156') // 1885 kg·reps ≈ 4155.7 lb
    expect(out).not.toContain('kg')
  })

  it('rejects an unknown --unit value as a usage error', async () => {
    const h = harness(tokenEnv(tmp))
    await expect(
      h.run(['workouts', '--plain', '--limit', '5', '--unit', 'stone'], listFetch()),
    ).rejects.toThrow(/Invalid --unit: stone/)
  })

  it('auth status JSON never leaks tokens', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['auth', 'status', '--json'])

    const out = h.out.join('')
    expect(out).not.toContain('accessToken')
    expect(out).not.toContain('refreshToken')
    expect(out).toContain('"userId": "user-1"')
  })
})

describe('templates command', () => {
  function templatesFetch() {
    return createFetchMock([
      {
        match: (url) => url.includes('/templates'),
        handler: () =>
          mockResponse({
            _embedded: {
              template: [
                { id: 'tpl-0001', name: { en: 'Push Day' } },
                { id: 'tpl-0002', name: 'Pull Day' },
              ],
            },
          }),
      },
    ])
  }

  it('lists template names in plain output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['templates', '--plain'], templatesFetch())

    const out = h.out.join('')
    expect(out).toContain('Push Day')
    expect(out).toContain('Pull Day')
  })

  it('filters by --search and lists ids in json output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['templates', '--search', 'push', '--json'], templatesFetch())

    const out = h.out.join('')
    expect(out).toContain('"id": "tpl-0001"')
    expect(out).toContain('"name": "Push Day"')
    expect(out).not.toContain('Pull Day')
  })

  it('requires authentication', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(h.run(['templates', '--plain'])).rejects.toThrow(/Not authenticated/)
  })
})
