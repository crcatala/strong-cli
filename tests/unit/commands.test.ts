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

  it('--json --unit lb keeps raw metric values in the output', async () => {
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
    await h.run(['workout', 'log-0001', '--json', '--unit', 'lb'], fetchImpl)

    const out = h.out.join('')
    // Raw weight values must stay canonical kg, not lb.
    expect(out).toContain('"weight": 60')
    expect(out).toContain('"weight": 70')
    expect(out).not.toContain('"weight": 132.28')
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
        // getTemplates walks the user doc with include=template (paginated).
        match: (url) => url.includes('include=template'),
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

  it('respects --limit', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['templates', '--plain', '--limit', '1'], templatesFetch())

    const out = h.out.join('')
    expect(out).toContain('Push Day')
    expect(out).not.toContain('Pull Day')
  })

  it('rejects --limit 0 as a usage error', async () => {
    const h = harness(tokenEnv(tmp))
    await expect(h.run(['templates', '--plain', '--limit', '0'], templatesFetch())).rejects.toThrow(
      /Invalid --limit/,
    )
  })

  it('requires authentication', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(h.run(['templates', '--plain'])).rejects.toThrow(/Not authenticated/)
  })
})

describe('tags command', () => {
  function tagsFetch() {
    return createFetchMock([
      {
        match: (url) => url.includes('include=tag'),
        handler: () =>
          mockResponse({
            id: 'user-1',
            _embedded: {
              tag: [
                { id: 'arms', name: { en: 'ARMS' } },
                { id: 'push', name: { en: 'PUSH' } },
              ],
            },
          }),
      },
    ])
  }

  it('lists tag names in plain output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['tags', '--plain'], tagsFetch())

    const out = h.out.join('')
    expect(out).toContain('ARMS')
    expect(out).toContain('PUSH')
  })

  it('filters by --search and lists ids in json output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['tags', '--search', 'push', '--json'], tagsFetch())

    const out = h.out.join('')
    expect(out).toContain('"id": "push"')
    expect(out).toContain('"name": "PUSH"')
    expect(out).not.toContain('ARMS')
  })

  it('respects --limit and rejects 0', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['tags', '--plain', '--limit', '1'], tagsFetch())
    expect(h.out.join('')).toContain('ARMS')
    expect(h.out.join('')).not.toContain('PUSH')

    const h2 = harness(tokenEnv(tmp))
    await expect(h2.run(['tags', '--limit', '0'], tagsFetch())).rejects.toThrow(/Invalid --limit/)
  })

  it('requires authentication', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(h.run(['tags', '--plain'])).rejects.toThrow(/Not authenticated/)
  })
})

describe('folders command', () => {
  function foldersFetch() {
    return createFetchMock([
      {
        match: (url) => url.includes('include=folder'),
        handler: () =>
          mockResponse({
            id: 'user-1',
            _embedded: {
              folder: [
                { id: 'example-templates', name: { en: 'Example Templates' } },
                { id: 'my-plan', name: { en: 'My Plan' } },
              ],
            },
          }),
      },
    ])
  }

  it('lists folder names in plain output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['folders', '--plain'], foldersFetch())

    const out = h.out.join('')
    expect(out).toContain('Example Templates')
    expect(out).toContain('My Plan')
  })

  it('filters by --search and lists ids in json output', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['folders', '--search', 'plan', '--json'], foldersFetch())

    const out = h.out.join('')
    expect(out).toContain('"id": "my-plan"')
    expect(out).not.toContain('Example Templates')
  })

  it('requires authentication', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(h.run(['folders', '--plain'])).rejects.toThrow(/Not authenticated/)
  })
})

describe('--tag filter on workouts/stats/export', () => {
  function taggedFetch(tagMeasurementIds: string[]) {
    return createFetchMock([
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () => mockResponse({ _embedded: { measurement: globalMeasurements } }),
      },
      {
        match: (url) => url.includes('include=measurement'),
        handler: () => {
          const base = syntheticUserResponse([])
          return mockResponse({
            ...base,
            _embedded: {
              ...base._embedded,
              tag: [
                {
                  id: 'push',
                  name: { en: 'PUSH' },
                  _links: {
                    measurement: tagMeasurementIds.map((id) => ({
                      href: `/api/users/user-1/measurements/${id}`,
                    })),
                  },
                },
              ],
            },
          })
        },
      },
      {
        match: (url) => url.includes('include=log'),
        handler: () => mockResponse(syntheticUserResponse([syntheticLog()])),
      },
    ])
  }

  it('workouts --tag keeps workouts containing tagged exercises', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(
      ['workouts', '--plain', '--limit', '5', '--tag', 'push'],
      taggedFetch([MEASUREMENT_IDS.squatMachine]),
    )
    const out = h.out.join('')
    expect(out).toContain('log-0001')
    expect(out).toContain('Leg Day')
  })

  it('workouts --tag filters out workouts without the tagged exercise', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(
      ['workouts', '--plain', '--limit', '5', '--tag', 'push'],
      taggedFetch(['some-other-measurement']),
    )
    expect(h.out.join('')).toContain('(no workouts)')
  })

  it('workouts --tag rejects an unknown tag with a usage error', async () => {
    const h = harness(tokenEnv(tmp))
    await expect(
      h.run(['workouts', '--plain', '--tag', 'nope'], taggedFetch([MEASUREMENT_IDS.squatMachine])),
    ).rejects.toThrow(/Unknown tag: nope/)
  })

  it('stats --tag aggregates only tagged workouts', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['stats', '--json', '--tag', 'push'], taggedFetch([MEASUREMENT_IDS.squatMachine]))
    expect(JSON.parse(h.out.join('')).totals.workouts).toBe(1)

    const h2 = harness(tokenEnv(tmp))
    await h2.run(['stats', '--json', '--tag', 'push'], taggedFetch(['other-measurement']))
    expect(JSON.parse(h2.out.join('')).totals.workouts).toBe(0)
  })

  it('export --tag emits only tagged workouts and records the filter', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(['export', '--json', '--tag', 'push'], taggedFetch([MEASUREMENT_IDS.squatMachine]))
    const doc = JSON.parse(h.out.join(''))
    expect(doc.filter).toEqual({ tag: 'push' })
    expect(doc.workouts).toHaveLength(1)
    expect(doc.totals.workouts).toBe(1)

    const h2 = harness(tokenEnv(tmp))
    await h2.run(['export', '--json', '--tag', 'push'], taggedFetch(['other-measurement']))
    const doc2 = JSON.parse(h2.out.join(''))
    expect(doc2.workouts).toHaveLength(0)
    expect(doc2.totals.workouts).toBe(0)
  })

  it('stats --weeks --tag composes both filters', async () => {
    const recentDate = new Date(Date.now() - 2 * 86400000).toISOString()
    const oldDate = new Date(Date.now() - 30 * 86400000).toISOString()
    const mock = createFetchMock([
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () => mockResponse({ _embedded: { measurement: globalMeasurements } }),
      },
      {
        match: (url) => url.includes('include=measurement'),
        handler: () => {
          const base = syntheticUserResponse([])
          return mockResponse({
            ...base,
            _embedded: {
              ...base._embedded,
              tag: [
                {
                  id: 'push',
                  name: { en: 'PUSH' },
                  _links: {
                    measurement: [
                      { href: `/api/users/user-1/measurements/${MEASUREMENT_IDS.squatMachine}` },
                    ],
                  },
                },
              ],
            },
          })
        },
      },
      {
        match: (url) => url.includes('include=log'),
        handler: () =>
          mockResponse(
            syntheticUserResponse([
              syntheticLog({ id: 'log-old', startDate: oldDate }),
              syntheticLog({ id: 'log-recent', startDate: recentDate }),
            ]),
          ),
      },
    ])

    const h = harness(tokenEnv(tmp))
    await h.run(['stats', '--json', '--weeks', '1', '--tag', 'push'], mock)
    const doc = JSON.parse(h.out.join(''))
    expect(doc.totals.workouts).toBe(1)
  })

  it('workouts --fresh --tag composes both flags', async () => {
    const h = harness(tokenEnv(tmp))
    await h.run(
      ['workouts', '--plain', '--limit', '5', '--fresh', '--tag', 'push'],
      taggedFetch([MEASUREMENT_IDS.squatMachine]),
    )
    expect(h.out.join('')).toContain('Leg Day')
  })
})
