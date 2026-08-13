/**
 * Live tests against the real Strong backend (https://back.strong.app).
 *
 * Gated behind RUN_LIVE_TESTS=1. The first two tests hit only the public
 * exercise-library endpoint (no credentials needed). The third test requires
 * real credentials via env vars.
 *
 *   RUN_LIVE_TESTS=1 STRONG_USERNAME=you@example.com STRONG_PASSWORD=... \
 *     npx vitest run tests/live --no-file-parallelism
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StrongClient } from '../../src/api/client.js'
import type { RawLog } from '../../src/api/types.js'
import { AuthError } from '../../src/cli/errors.js'
import { buildEnvelope } from '../../src/write/envelope.js'
import { SyncEngine } from '../../src/write/sync-engine.js'
import { COLLECTIONS, type CollectionName, type Snapshot } from '../../src/write/types.js'
import { memStore } from './mem-store.js'

const RUN_LIVE = process.env['RUN_LIVE_TESTS'] === '1'

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

  it('walks the full snapshot and round-trips an empty envelope PUT (disposable account only)', async () => {
    const username = process.env['STRONG_USERNAME'] ?? process.env['STRONG_USER']
    const password = process.env['STRONG_PASSWORD']
    if (!username || !password) {
      console.warn('  (skipped: STRONG_USERNAME/STRONG_PASSWORD not set)')
      return
    }

    const client2 = new StrongClient({ baseUrl: 'https://back.strong.app', store: memStore() })
    const session = await client2.login(username, password)

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

    // Envelope PUT round-trip: an empty envelope (no changes) must be accepted
    // and must NOT mutate server truth — the backend merges by id rather than
    // replacing collections (verified protocol semantics from strong-mcp).
    await client2.putEnvelope(session.userId, buildEnvelope(session.userId, []))
    const after = await engine.resync()
    for (const collection of COLLECTIONS) {
      expect(entityCount(after, collection)).toBe(entityCount(snapshot, collection))
    }
  }, 180_000)
})

function entityCount(snapshot: Snapshot, collection: CollectionName): number {
  return Object.keys(snapshot.entities[collection]).length
}
