/**
 * CLI tests for the opt-in write subcommands of `strong templates`
 * (routine templates, sc-ho9c).
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

const myTemplates = {
  id: 'folder-my-templates',
  name: { custom: 'My Templates' },
  isHidden: false,
  _links: { template: [] },
}

const existingTemplate = {
  id: 'tpl-1',
  logType: 'TEMPLATE',
  name: { custom: 'Push Day' },
  isHidden: false,
  lastChanged: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-tpl-write-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  resetEnv()
})

describe('templates create (opt-in write)', () => {
  it('refuses to write without the --write opt-in flag', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'create', 'Push Day', '--exercise', 'ex-1:10@60'], fetchImpl),
    ).rejects.toThrow(/writes are opt-in: add --write/)
    expect(puts).toHaveLength(0)
  })

  it('creates a template and PUTs the expected envelope with a folder link', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['templates', 'create', 'Push Day', '--write', '--exercise', 'ex-1:10@60,8@70~8', '--plain'],
      fetchImpl,
    )

    expect(h.out.join('')).toMatch(/created template "Push Day" \([0-9a-f-]{36}\)/)
    expect(puts).toHaveLength(1)
    const { _embedded } = puts[0].body
    const sent = _embedded.template[0]
    expect(sent.logType).toBe('TEMPLATE')
    expect(sent.name).toEqual({ custom: 'Push Day' })
    expect(sent.isHidden).toBe(false)
    const group = sent._embedded.cellSetGroup[0]
    expect(group._links.measurement).toEqual({ href: '/api/users/user-1/measurements/ex-1' })
    // Two working sets -> two working cellSets + two trailing REST_TIMER sets.
    expect(group.cellSets).toHaveLength(4)
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
    // Folder link travels in the same envelope.
    const folderSent = _embedded.folder[0]
    expect(folderSent.id).toBe('folder-my-templates')
    expect(folderSent._links.template).toEqual([{ href: `/api/users/user-1/templates/${sent.id}` }])
    // Unchanged collections travel as empty arrays.
    expect(_embedded.log).toEqual([])
    expect(_embedded.measurement).toEqual([])
  })

  it('honors an explicit --folder', async () => {
    const other = {
      id: 'folder-other',
      name: { custom: 'Other' },
      isHidden: false,
      _links: { template: [] },
    }
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [other] })
    const h = harness(tokenEnv(tmp))

    await h.run(
      [
        'templates',
        'create',
        'Push Day',
        '--write',
        '--exercise',
        'ex-1:10',
        '--folder',
        'folder-other',
      ],
      fetchImpl,
    )

    const folderSent = puts[0].body._embedded.folder[0]
    expect(folderSent.id).toBe('folder-other')
  })

  it('supports half-step RPE values (8.5) like the read path', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await h.run(
      ['templates', 'create', 'Push Day', '--write', '--exercise', 'ex-1:8@60~8.5', '--plain'],
      fetchImpl,
    )

    const sent = puts[0].body._embedded.template[0]
    const rpeCell = sent._embedded.cellSetGroup[0].cellSets[0].cells.find(
      (c: { cellType: string }) => c.cellType === 'RPE',
    )
    expect(rpeCell.value).toBe('8.5')
  })

  it('fails cleanly for an unknown exercise id', async () => {
    const { fetchImpl, puts } = writeFetch({ folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'create', 'X', '--write', '--exercise', 'ex-missing:10'], fetchImpl),
    ).rejects.toThrow(/Unknown exercise id "ex-missing"/)
    expect(puts).toHaveLength(0)
  })

  it('fails cleanly for an archived exercise id', async () => {
    const archived = { ...squat, isHidden: true }
    const { fetchImpl, puts } = writeFetch({ measurement: [archived], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'create', 'X', '--write', '--exercise', 'ex-1:10'], fetchImpl),
    ).rejects.toThrow(/Archived exercise id "ex-1"/)
    expect(puts).toHaveLength(0)
  })

  it('fails cleanly for an unknown folder id', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(
        [
          'templates',
          'create',
          'X',
          '--write',
          '--exercise',
          'ex-1:10',
          '--folder',
          'folder-missing',
        ],
        fetchImpl,
      ),
    ).rejects.toThrow(/Unknown folder id "folder-missing"/)
    expect(puts).toHaveLength(0)
  })

  it('rejects a malformed set spec with a UsageError', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'create', 'X', '--write', '--exercise', 'ex-1:banana'], fetchImpl),
    ).rejects.toThrow(/Invalid set spec "banana"/)
    expect(puts).toHaveLength(0)
  })

  it('rejects a malformed --exercise spec', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'create', 'X', '--write', '--exercise', 'no-sets-here'], fetchImpl),
    ).rejects.toThrow(/Invalid --exercise/)
    expect(puts).toHaveLength(0)
  })

  it('requires at least one --exercise', async () => {
    const { fetchImpl, puts } = writeFetch({ measurement: [squat], folder: [myTemplates] })
    const h = harness(tokenEnv(tmp))

    await expect(h.run(['templates', 'create', 'X', '--write'], fetchImpl)).rejects.toThrow(
      /--exercise is required/,
    )
    expect(puts).toHaveLength(0)
  })
})

describe('templates rename (opt-in write)', () => {
  it('renames an existing template via envelope PUT', async () => {
    const { fetchImpl, puts } = writeFetch({ template: [existingTemplate] })
    const h = harness(tokenEnv(tmp))

    await h.run(['templates', 'rename', 'tpl-1', 'Leg Day', '--write', '--plain'], fetchImpl)

    expect(h.out.join('')).toMatch(/renamed template tpl-1 -> "Leg Day"/)
    expect(puts).toHaveLength(1)
    const sent = puts[0].body._embedded.template[0]
    expect(sent.id).toBe('tpl-1')
    expect(sent.name).toEqual({ custom: 'Leg Day' })
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch({})
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'rename', 'tpl-missing', 'X', '--write'], fetchImpl),
    ).rejects.toThrow(/Unknown template id "tpl-missing"/)
    expect(puts).toHaveLength(0)
  })
})

describe('templates delete (opt-in write)', () => {
  it('soft-deletes a template and unlinks it from its folder', async () => {
    const folderWithLink = {
      id: 'folder-my-templates',
      name: { custom: 'My Templates' },
      isHidden: false,
      _links: { template: [{ href: '/api/users/user-1/templates/tpl-1' }] },
    }
    const { fetchImpl, puts } = writeFetch({
      template: [existingTemplate],
      folder: [folderWithLink],
    })
    const h = harness(tokenEnv(tmp))

    await h.run(['templates', 'delete', 'tpl-1', '--write', '--plain'], fetchImpl)

    expect(h.out.join('')).toMatch(/deleted template tpl-1/)
    expect(puts).toHaveLength(1)
    const { _embedded } = puts[0].body
    const sent = _embedded.template[0]
    expect(sent.id).toBe('tpl-1')
    expect(sent.isHidden).toBe(true)
    const folderSent = _embedded.folder[0]
    expect(folderSent.id).toBe('folder-my-templates')
    expect(folderSent._links.template).toEqual([])
  })

  it('fails cleanly for an id absent from the account', async () => {
    const { fetchImpl, puts } = writeFetch({})
    const h = harness(tokenEnv(tmp))

    await expect(
      h.run(['templates', 'delete', 'tpl-missing', '--write'], fetchImpl),
    ).rejects.toThrow(/Unknown template id "tpl-missing"/)
    expect(puts).toHaveLength(0)
  })
})

describe('templates write auth', () => {
  it('requires authentication for writes', async () => {
    const h = harness({ XDG_CONFIG_HOME: tmp })
    await expect(
      h.run(['templates', 'create', 'X', '--write', '--exercise', 'ex-1:10']),
    ).rejects.toThrow(/Not authenticated/)
  })
})
