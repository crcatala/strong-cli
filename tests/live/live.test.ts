/**
 * Live tests against the real Strong backend (https://back.strong.app).
 *
 * Gated behind RUN_LIVE_TESTS=1. The first two tests hit only the public
 * exercise-library endpoint (no credentials needed). The third test requires
 * real credentials via env vars.
 *
 *   RUN_LIVE_TESTS=1 STRONG_USERNAME=you@example.com STRONG_PASSWORD=... \
 *     npx vitest run tests/live --no-file-parallelism
 *
 * The single mutation test additionally requires RUN_LIVE_WRITE_TESTS=1 and
 * STRONG_DISPOSABLE_USER_ID=<the logged-in disposable account id>.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import type { RawLog } from '../../src/api/types.js'
import { AuthError } from '../../src/cli/errors.js'
import { buildEnvelope } from '../../src/write/envelope.js'
import { makeClock, newId } from '../../src/write/ids.js'
import { softDelete } from '../../src/write/soft-delete.js'
import { SyncEngine } from '../../src/write/sync-engine.js'
import { COLLECTIONS, type Entity } from '../../src/write/types.js'
import { memStore } from './mem-store.js'

const RUN_LIVE = process.env['RUN_LIVE_TESTS'] === '1'
// Writes need a second opt-in plus the expected disposable-account id. This
// prevents an ordinary RUN_LIVE_TESTS invocation from mutating an account.
const RUN_LIVE_WRITES =
  process.env['RUN_LIVE_WRITE_TESTS'] === '1' && !!process.env['STRONG_DISPOSABLE_USER_ID']

describe.skipIf(!RUN_LIVE)('live: Strong backend', () => {
  const client = new StrongClient({
    baseUrl: 'https://back.strong.app',
    store: memStore(),
  })

  it('reaches the public measurements endpoint', async () => {
    const page = await client.getMeasurements(1)
    expect(page.total).toBeGreaterThan(100)
    expect(page._embedded?.measurement?.length).toBeGreaterThan(0)
  })

  it('rejects bad credentials with AuthError', async () => {
    const bad = new StrongClient({
      baseUrl: 'https://back.strong.app',
      store: memStore(),
    })
    await expect(bad.login('[EMAIL]', 'definitely-wrong-password')).rejects.toBeInstanceOf(
      AuthError,
    )
  })

  it('logs in and fetches workouts with real credentials', async () => {
    const username = process.env['STRONG_USERNAME'] ?? process.env['STRONG_USER']
    const password = process.env['STRONG_PASSWORD']
    if (!username || !password) {
      console.warn('  (skipped: STRONG_USERNAME/STRONG_PASSWORD not set)')
      return
    }

    const client2 = new StrongClient({ baseUrl: 'https://back.strong.app', store: memStore() })
    const session = await client2.login(username, password)
    expect(session.userId).toBeTruthy()

    // Full-history walk: also exercises pagination guards + pacing against the
    // live backend (150ms/page default keeps it gentle). Allow plenty of time.
    const logs = await client2.getAllLogs(session.userId)
    expect(Array.isArray(logs)).toBe(true)
    console.log(`  fetched ${logs.length} logs for user ${session.userId}`)

    const measurements = await client2.getAllMeasurements()
    expect(measurements._embedded?.measurement?.length).toBeGreaterThan(0)
  }, 180_000)

  it('pages logs in lastChanged (modification) order — the invariant the incremental cache relies on', async () => {
    const username = process.env['STRONG_USERNAME'] ?? process.env['STRONG_USER']
    const password = process.env['STRONG_PASSWORD']
    if (!username || !password) {
      console.warn('  (skipped: STRONG_USERNAME/STRONG_PASSWORD not set)')
      return
    }

    const client2 = new StrongClient({ baseUrl: 'https://back.strong.app', store: memStore() })
    const session = await client2.login(username, password)

    // Two small pages, walked explicitly (walkLogs has no "stop after N
    // pages silently" mode — its page cap is a guard that throws when more
    // data exists, and this account has ~75 pages).
    const first = await client2.getUser(session.userId, {
      limit: 25,
      continuation: '',
      includes: ['log'],
    })
    const firstLogs = (first._embedded?.log ?? []) as RawLog[]
    const next = first._links?.next
    if (!next?.href) {
      expect(next).toBeTruthy() // fail loudly: the account should span pages
      return
    }
    const nextContinuation =
      new URL(next.href, 'https://back.strong.app').searchParams.get('continuation') ?? ''
    expect(nextContinuation).toBeTruthy()

    const second = await client2.getUser(session.userId, {
      limit: 25,
      continuation: nextContinuation,
      includes: ['log'],
    })
    const logs = [...firstLogs, ...((second._embedded?.log ?? []) as RawLog[])]
    expect(logs.length).toBeGreaterThan(1)

    // Cursor bookkeeping: logs must carry ids + lastChanged for merge/order.
    expect(logs.every((l) => l.id)).toBe(true)
    expect(logs.every((l) => l.lastChanged)).toBe(true)

    // Pagination order is by modification time, oldest first (non-decreasing).
    // The incremental cache resumes from a stored continuation token, so if
    // the backend ever changes this ordering the cache's provenance breaks
    // and this test should fail loudly.
    const changed = logs.map((l) => l.lastChanged).filter((v): v is string => typeof v === 'string')
    for (let i = 1; i < changed.length; i++) {
      expect(Date.parse(changed[i])).toBeGreaterThanOrEqual(Date.parse(changed[i - 1]))
    }

    // Ids must be unique across the fetched pages (merge-by-id depends on it).
    const ids = logs.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.skipIf(!RUN_LIVE_WRITES)(
    'creates, verifies, and archives a disposable-account exercise through envelope PUT',
    async () => {
      const username = process.env['STRONG_USERNAME'] ?? process.env['STRONG_USER']
      const password = process.env['STRONG_PASSWORD']
      const disposableUserId = process.env['STRONG_DISPOSABLE_USER_ID']
      if (!username || !password || !disposableUserId) {
        throw new Error('Write live tests require credentials and STRONG_DISPOSABLE_USER_ID')
      }

      const client2 = new StrongClient({ baseUrl: 'https://back.strong.app', store: memStore() })
      const session = await client2.login(username, password)
      if (session.userId !== disposableUserId) {
        throw new Error(
          'Refusing write live test: logged-in user does not match STRONG_DISPOSABLE_USER_ID',
        )
      }

      // Per-run temp snapshot path — never touches the real config dir.
      const snapshotPath = join(tmpdir(), `strong-live-snapshot-${Date.now()}.json`)
      const engine = new SyncEngine({ client: client2, userId: session.userId, snapshotPath })

      // Full 8-collection walk against the live backend.
      const snapshot = await engine.sync()
      for (const collection of COLLECTIONS) {
        expect(snapshot.entities[collection]).toBeDefined()
      }

      // getTemplates must agree with the snapshot's template collection —
      // both walk the user doc paginated (sc-sfn8 fix).
      const templates = await client2.getTemplates(session.userId)
      expect(templates.map((t) => t.id).sort()).toEqual(
        Object.keys(snapshot.entities.template).sort(),
      )

      // A complete minimal custom-exercise shape, ported from the captured
      // Strong protocol. The finally block archives it even if verification fails.
      const clock = makeClock()
      const created = buildLiveExercise(clock())
      let putSucceeded = false
      try {
        await client2.putEnvelope(
          session.userId,
          buildEnvelope(session.userId, [{ collection: 'measurement', entity: created }]),
        )
        putSucceeded = true

        const afterCreate = await engine.resync()
        expect(afterCreate.entities.measurement[created.id]).toMatchObject({
          id: created.id,
          isHidden: false,
          name: created.name,
        })
      } finally {
        if (putSucceeded) {
          const archived = softDelete(created, clock)
          await client2.putEnvelope(
            session.userId,
            buildEnvelope(session.userId, [{ collection: 'measurement', entity: archived }]),
          )
          const afterArchive = await engine.resync()
          const archivedOnServer = afterArchive.entities.measurement[created.id]
          expect(archivedOnServer === undefined || archivedOnServer.isHidden === true).toBe(true)
        }
      }
    },
    180_000,
  )
})

function buildLiveExercise(timestamp: string): Entity {
  const id = newId()
  return {
    id,
    measurementType: 'EXERCISE',
    name: { custom: `strong-cli live ${id}` },
    instructions: { custom: '' },
    notes: null,
    isGlobal: false,
    isHidden: false,
    tools: [],
    cellTypeConfigs: [{ cellType: 'REPS', mandatory: true, isExponent: false, index: 0 }],
    _links: { tag: [] },
    created: timestamp,
    lastChanged: timestamp,
  }
}
