import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StrongClient } from '../../../src/api/client.js'
import { emptySnapshot, loadSnapshot, saveSnapshot } from '../../../src/write/snapshot-store.js'
import { SyncEngine } from '../../../src/write/sync-engine.js'
import { COLLECTIONS } from '../../../src/write/types.js'
import { futureJwt, memStore, mockResponse, syntheticLog } from '../../helpers/fixtures.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'strong-cli-snapshot-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function makeClient(fetchImpl: typeof fetch): StrongClient {
  return new StrongClient({
    baseUrl: 'https://back.strong.app',
    store: memStore({
      accessToken: futureJwt(1200),
      refreshToken: 'rt',
      userId: 'user-1',
      expiresAt: Date.now() + 1200_000,
    }),
    fetch: fetchImpl,
  })
}

/** A single user-doc page carrying logs (+ optional next continuation). */
function logPage(logs: unknown[], continuation?: string) {
  return mockResponse({
    id: 'user-1',
    _links: continuation
      ? { next: { href: `/api/users/user-1?include=log&continuation=${continuation}&limit=200` } }
      : undefined,
    _embedded: { log: logs },
    preferences: { weightUnit: { 'user-1': 'POUNDS' } },
  })
}

const snapshotPath = () => join(tmp, 'snapshot.json')

describe('SyncEngine', () => {
  it('first sync walks the full stream, merges entities and persists', async () => {
    const page1 = logPage([syntheticLog({ id: 'log-1' })], 'TOKEN2')
    const page2 = logPage([syntheticLog({ id: 'log-2' })])
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('continuation=TOKEN2')) return page2
      return page1
    }
    const engine = new SyncEngine({
      client: makeClient(fetchImpl),
      userId: 'user-1',
      snapshotPath: snapshotPath(),
    })

    const snapshot = await engine.sync()

    expect(Object.keys(snapshot.entities.log)).toEqual(['log-1', 'log-2'])
    expect(snapshot.entities.log['log-1']?.id).toBe('log-1')
    expect(snapshot.preferences).toEqual({ weightUnit: { 'user-1': 'POUNDS' } })
    expect(snapshot.syncedAt).toBeTruthy()
    // Every collection present in the merged snapshot (all-empty for the rest).
    for (const c of COLLECTIONS) expect(snapshot.entities[c]).toBeDefined()

    const stored = loadSnapshot('user-1', snapshotPath())
    expect(stored).not.toBeNull()
    expect(Object.keys(stored?.entities.log ?? {})).toEqual(['log-1', 'log-2'])
  })

  it('delta sync merges new entities over the stored snapshot and keeps the rest', async () => {
    // Seed a stored snapshot with log-1 + a stored continuation.
    const seeded = emptySnapshot('user-1')
    seeded.entities.log['log-1'] = syntheticLog({ id: 'log-1' })
    seeded.continuation = 'TOKEN5'
    saveSnapshot(seeded, snapshotPath())

    // The re-delivered tail contains a NEW log only (log-2).
    const fetchImpl = async () => logPage([syntheticLog({ id: 'log-2' })])
    const engine = new SyncEngine({
      client: makeClient(fetchImpl),
      userId: 'user-1',
      snapshotPath: snapshotPath(),
    })

    const snapshot = await engine.sync()

    expect(Object.keys(snapshot.entities.log).sort()).toEqual(['log-1', 'log-2'])
    // No next link on the fresh page -> continuation falls back to stored.
    expect(snapshot.continuation).toBe('TOKEN5')
  })

  it('full re-walk on a stale cursor (HTTP 400) replaces the stored snapshot', async () => {
    // Seed a snapshot with a stale continuation that the server rejects.
    const seeded = emptySnapshot('user-1')
    seeded.entities.log['log-1'] = syntheticLog({ id: 'log-1' })
    seeded.continuation = 'STALE'
    saveSnapshot(seeded, snapshotPath())

    // First request (resume from STALE) -> 400; follow-up full walk -> fresh data.
    let calls = 0
    const fetchImpl = async () => {
      calls++
      if (calls === 1) return mockResponse({ title: 'Bad Request' }, { status: 400 })
      return logPage([syntheticLog({ id: 'log-9' })])
    }
    const engine = new SyncEngine({
      client: makeClient(fetchImpl),
      userId: 'user-1',
      snapshotPath: snapshotPath(),
    })

    const snapshot = await engine.sync()

    expect(calls).toBe(2)
    expect(Object.keys(snapshot.entities.log)).toEqual(['log-9']) // stale log-1 dropped
    const stored = loadSnapshot('user-1', snapshotPath())
    expect(Object.keys(stored?.entities.log ?? {})).toEqual(['log-9'])
  })

  it('resync fetches pristine server truth without persisting', async () => {
    // No snapshot file at all.
    const fetchImpl = async () => logPage([syntheticLog({ id: 'log-r' })])
    const engine = new SyncEngine({
      client: makeClient(fetchImpl),
      userId: 'user-1',
      snapshotPath: snapshotPath(),
    })

    const snapshot = await engine.resync()

    expect(Object.keys(snapshot.entities.log)).toEqual(['log-r'])
    expect(existsSync(snapshotPath())).toBe(false) // nothing persisted
    // resync starts from the first page regardless of any stored cursor.
    expect(snapshot.continuation).toBe('')
  })

  it('merges multiple collections from the same walk', async () => {
    const fetchImpl = async () =>
      mockResponse({
        id: 'user-1',
        _embedded: {
          template: [{ id: 'tpl-1', name: { custom: 'Push Day' } }],
          tag: [{ id: 'tag-1', name: { en: 'arms' } }],
        },
      })
    const engine = new SyncEngine({
      client: makeClient(fetchImpl),
      userId: 'user-1',
      snapshotPath: snapshotPath(),
    })

    const snapshot = await engine.sync()

    expect(snapshot.entities.template['tpl-1']?.name).toEqual({ custom: 'Push Day' })
    expect(snapshot.entities.tag['tag-1']?.name).toEqual({ en: 'arms' })
    expect(Object.keys(snapshot.entities.log)).toEqual([])
  })
})
