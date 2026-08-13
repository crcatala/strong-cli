/**
 * CLI tests for the opt-in write subcommands of `strong workout`
 * (completed workouts, sc-iwa3): `log` / `delete` / `edit`.
 *
 * The write path runs a user-doc walk (GET) to refresh the snapshot, then a
 * single envelope PUT. `edit` additionally runs a post-write re-sync (second
 * GET walk) to verify the INFERRED shape — the fetch mock echoes the PUT body
 * for "server landed it" (serverConfirmed: true) or the stale log for false.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnv } from '../../src/config/config.js'
import { runCli } from '../../src/run.js'
import { createFetchMock, futureJwt, type LooseEntity, mockResponse } from '../helpers/fixtures.js'

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

function userDoc(embedded: Record<string, unknown[]> = {}) {
  return {
    id: 'user-1',
    _links: { self: { href: '/api/users/user-1' } },
    _embedded: embedded,
    preferences: { weightUnit: { 'user-1': 'KILOGRAMS' } },
  }
}

/** Mock the write path: user-doc walk (GET) + envelope PUT (captured). */
function writeFetch(embedded: Record<string, unknown[]> = {}) {
  const puts: Array<{ body: { _embedded: Record<string, LooseEntity[]> } }> = []
  const fetchImpl = createFetchMock([
    {
      match: (url, init) => url.includes('/api/users/user-1') && (init?.method ?? 'GET') === 'GET',
      handler: () => mockResponse(userDoc(embedded)),
    },
    {
      match: (url, init) => url.includes('/api/users/user-1') && (init?.method ?? '') === 'PUT',
      handler: (_url, init) => {
        puts.push({ body: JSON.parse(String(init?.body)) })
        return mockResponse({})
      },
    },
  ])
  return { fetchImpl, puts }
}

/**
 * Mock the edit path: refresh walk (GET #1) -> PUT -> verification re-sync
 * (GET #2). With `echoEdit: true` the second walk returns the PUT body (the
 * server landed the edit -> serverConfirmed: true); with `false` it returns
 * the stale original log (edit unconfirmed).
 */
function editFetch(opts: { echoEdit: boolean }) {
  const puts: Array<{ body: { _embedded: Record<string, LooseEntity[]> } }> = []
  let gets = 0
  const fetchImpl = createFetchMock([
    {
      match: (url, init) => url.includes('/api/users/user-1') && (init?.method ?? 'GET') === 'GET',
      handler: () => {
        gets++
        let log: unknown = workoutLog
        if (gets > 1 && opts.echoEdit) {
          log = puts[0]?.body._embedded.log[0] ?? workoutLog
        }
        return mockResponse(userDoc({ log: [log] }))
      },
    },
    {
      match: (url, init) => url.includes('/api/users/user-1') && (init?.method ?? '') === 'PUT',
      handler: (_url, init) => {
        puts.push({ body: JSON.parse(String(init?.body)) })
        return mockResponse({})
      },
    },
  ])
  return { fetchImpl, puts }
}

const squat = {
  id: 'ex-1',
  measurementType: 'EXERCISE',
  name: { custom: 'Squat' },
  cellTypeConfigs: [
    { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
    { cellType: 'BARBELL_WEIGHT', mandatory: false, isExponent: false, index: 1 },
    { cellType: 'RPE', mandatory: false, isExponent: true, index: 2 },
  ],
}

const workoutLog = {
  id: 'w-1',
  logType: 'WORKOUT',
  name: { custom: 'Push Day' },
  isHidden: false,
  lastChanged: '2026-01-01T00:00:00.000Z',
  _embedded: {
    cellSetGroup: [
      {
        id: 'g-1',
        cellSets: [
          {
            id: 's-1',
            isCompleted: true,
            cells: [
              { id: 'c-1', cellType: 'BARBELL_WEIGHT', value: '60', isHidden: false },
              { id: 'c-2', cellType: 'REPS', value: '10', isHidden: false },
              { id: 'c-3', cellType: 'RPE', value: null, isHidden: false },
            ],
          },
          { id: 'r-1', cells: [{ id: 'c-4', cellType: 'REST_TIMER', value: '85' }] },
        ],
      },
    ],
  },
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-wkt-write-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  resetEnv()
})

describe('workout log (opt-in write)', () => {
  it('refuses to write without the --write opt-in flag', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['workout', 'log', 'Push Day', '--exercise', 'ex-1:10@60'], fetchImpl),
    ).rejects.toThrow(/writes are opt-in: add --write/)
    expect(puts).toHaveLength(0)
  })

  it('logs a workout and PUTs the expected WORKOUT envelope', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat] })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['workout', 'log', 'Push Day', '--write', '--exercise', 'ex-1:10@60,8@70~8', '--plain'],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/logged workout "Push Day" \([0-9a-f-]{36}\)/)
    expect(puts).toHaveLength(1)
    const { _embedded } = puts[0].body
    const sent = _embedded.log[0]
    expect(sent.logType).toBe('WORKOUT')
    expect(sent.name).toEqual({ custom: 'Push Day' })
    expect(sent.isHidden).toBe(false)
    expect(sent.startDate).toBeTruthy()
    expect(sent.endDate).toBeTruthy()
    expect(sent._links.template).toBeUndefined()
    const group = sent._embedded.cellSetGroup[0]
    expect(group._links.measurement).toEqual({ href: '/api/users/user-1/measurements/ex-1' })
    // Two working sets -> two working cellSets + two trailing REST_TIMER sets.
    expect(group.cellSets).toHaveLength(4)
    expect(group.cellSets[0].isCompleted).toBe(true)
    expect(group.cellSets[0].cells).toEqual([
      expect.objectContaining({ cellType: 'REPS', value: '10' }),
      expect.objectContaining({ cellType: 'BARBELL_WEIGHT', value: '60' }),
      expect.objectContaining({ cellType: 'RPE', value: null }),
    ])
    expect(group.cellSets[2].cells).toEqual([
      expect.objectContaining({ cellType: 'REPS', value: '8' }),
      expect.objectContaining({ cellType: 'BARBELL_WEIGHT', value: '70' }),
      expect.objectContaining({ cellType: 'RPE', value: '8' }),
    ])
    // Unchanged collections travel as empty arrays.
    expect(_embedded.template).toEqual([])
    expect(_embedded.measurement).toEqual([])
  })

  it('links a template when --template is supplied', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat] })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['workout', 'log', 'Push Day', '--write', '--exercise', 'ex-1:10', '--template', 'tpl-1'],
      fetchImpl,
    )

    const sent = puts[0].body._embedded.log[0]
    expect(sent._links.template).toEqual({ href: '/api/users/user-1/templates/tpl-1' })
  })

  it('fails cleanly for an unknown exercise id', async () => {
    const { fetchImpl, puts } = writeFetch({})
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['workout', 'log', 'X', '--write', '--exercise', 'ex-missing:10'], fetchImpl),
    ).rejects.toThrow(/Unknown exercise id "ex-missing"/)
    expect(puts).toHaveLength(0)
  })

  it('requires at least one --exercise', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat] })
    const h = harness(tokenEnv(tmp))

    await expect(h.run(['workout', 'log', 'X', '--write'], fetchImpl)).rejects.toThrow(
      /--exercise is required/,
    )
    expect(puts).toHaveLength(0)
  })
})

describe('workout delete (opt-in write)', () => {
  it('soft-deletes a logged workout via envelope PUT', async () => {
    const { fetchImpl, puts } = writeFetch({ log: [workoutLog] })
    const h = harness(tokenEnv(tmp))

    await h.run(['workout', 'delete', 'w-1', '--write', '--plain'], fetchImpl)

    expect(h.out.join('')).toMatch(/deleted workout w-1/)
    expect(puts).toHaveLength(1)
    const sent = puts[0].body._embedded.log[0]
    expect(sent.id).toBe('w-1')
    expect(sent.isHidden).toBe(true)
    // Cascade hides the group/set/cell rows too.
    const group = sent._embedded.cellSetGroup[0]
    expect(group.isHidden).toBe(true)
    expect(group.cellSets[0].isHidden).toBe(true)
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch({})
    const h = harness(tokenEnv(tmp))

    await expect(h.run(['workout', 'delete', 'w-missing', '--write'], fetchImpl)).rejects.toThrow(
      /Unknown workout id "w-missing"/,
    )
    expect(puts).toHaveLength(0)
  })
})

describe('workout edit (opt-in write, INFERRED + verified)', () => {
  it('edits a set, PUTs the rewritten cells, and reports serverConfirmed: true', async () => {
    const { fetchImpl, puts } = editFetch({ echoEdit: true })
    const h = harness(tokenEnv(tmp))

    await h.run(
      [
        'workout',
        'edit',
        'w-1',
        '--set',
        '0:0',
        '--reps',
        '8',
        '--weight',
        '70',
        '--write',
        '--plain',
      ],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/edited workout w-1 \(serverConfirmed: true\)/)
    expect(puts).toHaveLength(1)
    const sent = puts[0].body._embedded.log[0]
    expect(sent.id).toBe('w-1')
    const cells = sent._embedded.cellSetGroup[0].cellSets[0].cells
    const reps = cells.find((c: { cellType: string }) => c.cellType === 'REPS')
    const weight = cells.find((c: { cellType: string }) => c.cellType === 'BARBELL_WEIGHT')
    expect(reps.value).toBe('8')
    expect(weight.value).toBe('70') // KILOGRAMS prefs -> no conversion
  })

  it('includes serverConfirmed in JSON output', async () => {
    const { fetchImpl } = editFetch({ echoEdit: true })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['workout', 'edit', 'w-1', '--set', '0:0', '--reps', '8', '--write', '--json'],
      fetchImpl,
    )

    const parsed = JSON.parse(h.out.join(''))
    expect(parsed).toMatchObject({ id: 'w-1', action: 'edit', serverConfirmed: true })
  })

  it('reports serverConfirmed: false when re-synced server truth lacks the edit', async () => {
    const { fetchImpl } = editFetch({ echoEdit: false })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['workout', 'edit', 'w-1', '--set', '0:0', '--reps', '8', '--write', '--plain'],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/edited workout w-1 \(serverConfirmed: false\)/)
  })

  it('fails cleanly for a bad set index (no PUT)', async () => {
    const { fetchImpl, puts } = writeFetch({ log: [workoutLog] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['workout', 'edit', 'w-1', '--set', '0:9', '--reps', '8', '--write'], fetchImpl),
    ).rejects.toThrow(/working set index 9 out of range/)
    expect(puts).toHaveLength(0)
  })

  it('rejects --reps 0 (not a positive integer)', async () => {
    const { fetchImpl, puts } = writeFetch({ log: [workoutLog] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['workout', 'edit', 'w-1', '--set', '0:0', '--reps', '0', '--write'], fetchImpl),
    ).rejects.toThrow(/Invalid --reps: 0/)
    expect(puts).toHaveLength(0)
  })

  it('accepts --weight 0 (clearing added load on bodyweight sets)', async () => {
    const { fetchImpl, puts } = editFetch({ echoEdit: true })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['workout', 'edit', 'w-1', '--set', '0:0', '--weight', '0', '--write', '--plain'],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/serverConfirmed: true/)
    const sent = puts[0].body._embedded.log[0]
    const weight = sent._embedded.cellSetGroup[0].cellSets[0].cells.find(
      (c: { cellType: string }) => c.cellType === 'BARBELL_WEIGHT',
    )
    expect(weight.value).toBe('0')
  })

  it('fails cleanly for a malformed --set', async () => {
    const h = harness(tokenEnv(tmp))
    await expect(
      h.run(['workout', 'edit', 'w-1', '--set', 'banana', '--reps', '8', '--write']),
    ).rejects.toThrow(/Invalid --set "banana"/)
  })

  it('requires at least one of --reps/--weight/--rpe', async () => {
    const h = harness(tokenEnv(tmp))
    await expect(h.run(['workout', 'edit', 'w-1', '--set', '0:0', '--write'])).rejects.toThrow(
      /specify at least one of --reps, --weight, --rpe/,
    )
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch({})
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['workout', 'edit', 'w-missing', '--set', '0:0', '--reps', '8', '--write'], fetchImpl),
    ).rejects.toThrow(/Unknown workout id "w-missing"/)
    expect(puts).toHaveLength(0)
  })
})

describe('workout write auth', () => {
  it('requires authentication for writes', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(
      h.run(['workout', 'log', 'X', '--write', '--exercise', 'ex-1:10']),
    ).rejects.toThrow(/Not authenticated/)
  })
})
