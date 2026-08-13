/**
 * CLI tests for the opt-in write subcommands of `strong exercises`
 * (custom exercise definitions, sc-k14b).
 *
 * The write path runs a user-doc walk (GET) to refresh the snapshot, then a
 * single envelope PUT. The fetch mock serves a single empty page and captures
 * the PUT body for assertions.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnv } from '../../src/config/config.js'
import { runCli } from '../../src/run.js'
import { createFetchMock, futureJwt, mockResponse } from '../helpers/fixtures.js'

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

function userDoc(measurements: unknown[] = []) {
  return {
    id: 'user-1',
    _links: { self: { href: '/api/users/user-1' } },
    _embedded: { measurement: measurements },
    preferences: { weightUnit: { 'user-1': 'KILOGRAMS' } },
  }
}

/** Mock the write path: user-doc walk (GET) + envelope PUT (captured). */
function writeFetch(measurements: unknown[] = []) {
  const puts: Array<{ body: { _embedded: Record<string, unknown[]> } }> = []
  const fetchImpl = createFetchMock([
    {
      match: (url, init) => url.includes('/api/users/user-1') && (init?.method ?? 'GET') === 'GET',
      handler: () => mockResponse(userDoc(measurements)),
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

const existingExercise = {
  id: 'ex-1',
  measurementType: 'EXERCISE',
  name: { custom: 'Old Name' },
  instructions: { custom: '' },
  cellTypeConfigs: [{ cellType: 'REPS', mandatory: true, isExponent: false, index: 0 }],
  isGlobal: false,
  isHidden: false,
  created: '2026-01-01T00:00:00.000Z',
  lastChanged: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-ex-write-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  resetEnv()
})

describe('exercises --user', () => {
  it('hides archived custom definitions and treats omitted isGlobal as custom', async () => {
    const h = harness(tokenEnv(tmp))
    const fetchImpl = createFetchMock([
      {
        match: (url) => url.includes('/api/measurements'),
        handler: () =>
          mockResponse({
            _embedded: {
              measurement: [{ id: 'global-1', name: { en: 'Public' }, isGlobal: true }],
            },
          }),
      },
      {
        match: (url) => url.includes('/api/users/user-1'),
        handler: () =>
          mockResponse(
            userDoc([
              { id: 'custom-1', name: { custom: 'Visible custom' } },
              { id: 'custom-archived', name: { custom: 'Archived custom' }, isHidden: true },
            ]),
          ),
      },
    ])

    await h.run(['exercises', '--user', '--json'], fetchImpl)

    expect(JSON.parse(h.out.join(''))).toEqual([
      expect.objectContaining({ id: 'global-1', global: true }),
      expect.objectContaining({ id: 'custom-1', global: false }),
    ])
  })
})

describe('exercises create (opt-in write)', () => {
  it('refuses to write without the --write opt-in flag', async () => {
    const { fetchImpl, puts } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['exercises', 'create', 'Hack Squat', '--cell-type', 'REPS,RPE'], fetchImpl),
    ).rejects.toThrow(/writes are opt-in: add --write/)
    expect(puts).toHaveLength(0)
  })

  it('creates a custom exercise and PUTs the expected envelope', async () => {
    const { fetchImpl, puts } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await h.run(
      [
        'exercises',
        'create',
        'Hack Squat',
        '--write',
        '--cell-type',
        'REPS,RPE',
        '--mandatory',
        'REPS',
        '--exponent',
        'RPE',
        '--notes',
        'deep hack squat',
        '--tag',
        'tag-1',
        '--plain',
      ],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/created exercise "Hack Squat" \([0-9a-f-]{36}\)/)
    expect(puts).toHaveLength(1)
    const { _embedded } = puts[0].body
    const sent = _embedded.measurement[0]
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
    expect(sent.measurementType).toBe('EXERCISE')
    expect(sent.isGlobal).toBe(false)
    expect(sent.isHidden).toBe(false)
    expect(sent.instructions).toEqual({ custom: 'deep hack squat' })
    expect(sent.cellTypeConfigs).toEqual([
      { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
      { cellType: 'RPE', mandatory: false, isExponent: true, index: 1 },
    ])
    expect(sent._links.tag).toEqual([{ href: '/api/users/user-1/tags/tag-1' }])
    // Unchanged collections travel as empty arrays.
    expect(_embedded.log).toEqual([])
    expect(_embedded.template).toEqual([])
  })

  it('prints JSON output with the created id', async () => {
    const { fetchImpl } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['exercises', 'create', 'Bench', '--write', '--cell-type', 'REPS', '--json'],
      fetchImpl,
    )

    const out = h.out.join('')
    expect(out).toContain('"action": "create"')
    expect(out).toContain('"name": "Bench"')
  })

  it('rejects unknown cell types with a UsageError', async () => {
    const { fetchImpl, puts } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['exercises', 'create', 'Weird', '--write', '--cell-type', 'NOPE'], fetchImpl),
    ).rejects.toThrow(/Unknown cell type "NOPE"/)
    expect(puts).toHaveLength(0)
  })

  it('rejects duplicate cell types and empty lists', async () => {
    const { fetchImpl } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['exercises', 'create', 'Dup', '--write', '--cell-type', 'REPS,REPS'], fetchImpl),
    ).rejects.toThrow(/Duplicate cell type "REPS"/)

    await expect(
      h.run(['exercises', 'create', 'Empty', '--write', '--cell-type', ' , '], fetchImpl),
    ).rejects.toThrow(/at least one cell type/)
  })

  it('rejects --mandatory/--exponent refs outside --cell-type', async () => {
    const { fetchImpl } = writeFetch()
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(
        ['exercises', 'create', 'X', '--write', '--cell-type', 'REPS', '--mandatory', 'RPE'],
        fetchImpl,
      ),
    ).rejects.toThrow(/--mandatory cell type "RPE" is not listed in --cell-type/)
  })
})

describe('exercises rename (opt-in write)', () => {
  it('renames an existing custom exercise via envelope PUT', async () => {
    const { fetchImpl, puts } = writeFetch([existingExercise])
    const h = harness(tokenEnv(tmp))

    await h.run(['exercises', 'rename', 'ex-1', 'Hack Squat', '--write', '--plain'], fetchImpl)

    expect(h.out.join('')).toMatch(/renamed exercise ex-1 -> "Hack Squat"/)
    expect(puts).toHaveLength(1)
    const sent = puts[0].body._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
    // The rest of the definition is preserved byte-for-byte.
    expect(sent.cellTypeConfigs).toEqual(existingExercise.cellTypeConfigs)
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch([])
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['exercises', 'rename', 'ex-missing', 'X', '--write'], fetchImpl),
    ).rejects.toThrow(/Unknown custom exercise id "ex-missing"/)
    expect(puts).toHaveLength(0)
  })
})

describe('exercises archive (opt-in write)', () => {
  it('soft-deletes an existing custom exercise via envelope PUT', async () => {
    const { fetchImpl, puts } = writeFetch([existingExercise])
    const h = harness(tokenEnv(tmp))

    await h.run(['exercises', 'archive', 'ex-1', '--write', '--plain'], fetchImpl)

    expect(h.out.join('')).toMatch(/archived exercise ex-1/)
    expect(puts).toHaveLength(1)
    const sent = puts[0].body._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.isHidden).toBe(true)
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch([])
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['exercises', 'archive', 'ex-missing', '--write'], fetchImpl),
    ).rejects.toThrow(/Unknown custom exercise id "ex-missing"/)
    expect(puts).toHaveLength(0)
  })
})

describe('exercises write auth', () => {
  it('requires authentication for writes', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(
      h.run(['exercises', 'create', 'X', '--write', '--cell-type', 'REPS']),
    ).rejects.toThrow(/Not authenticated/)
  })
})
