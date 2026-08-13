import { describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import { COLLECTIONS, type Snapshot } from '../../../src/write/types.js'
import { type WriteDeps, WriteEngine } from '../../../src/write/write-engine.js'

function snapshot(userId = 'user-1'): Snapshot {
  const s = emptySnapshot(userId)
  s.entities.log['log-0'] = { id: 'log-0', logType: 'WORKOUT' }
  return s
}

function deps(overrides: Partial<WriteDeps> = {}): WriteDeps & {
  refresh: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(async () => snapshot())
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist, ...overrides }
}

describe('WriteEngine', () => {
  it('refreshes, PUTs the envelope, merges optimistically and persists', async () => {
    const d = deps()
    const engine = new WriteEngine(d)
    const summary = await engine.write((snap) => {
      expect(snap.entities.log['log-0']).toBeDefined() // refreshed snapshot passed to build
      return {
        changes: [{ collection: 'log', entity: { id: 'log-new', logType: 'WORKOUT' } }],
        summary: { id: 'log-new' },
      }
    })

    expect(summary).toEqual({ id: 'log-new' })
    expect(d.refresh).toHaveBeenCalledTimes(1)

    // Envelope shape: userId from the snapshot, changed entity in _embedded.log.
    const envelope = d.put.mock.calls[0][0]
    expect(envelope.id).toBe('user-1')
    expect(envelope.strongAnalytics).toBe(false)
    expect(envelope._embedded.log).toEqual([{ id: 'log-new', logType: 'WORKOUT' }])
    expect(envelope._embedded.template).toEqual([])

    // Optimistic merge persisted after the PUT succeeded.
    const persisted = d.persist.mock.calls[0][0] as Snapshot
    expect(persisted.entities.log['log-new']).toBeDefined()
    expect(persisted.entities.log['log-0']).toBeDefined() // untouched entities kept
  })

  it('leaves the snapshot untouched and skips persist when the PUT fails', async () => {
    const put = vi.fn(async () => {
      throw new Error('HTTP 500')
    })
    const d = deps({ put })
    const engine = new WriteEngine(d)

    await expect(
      engine.write(() => ({
        changes: [{ collection: 'log', entity: { id: 'log-x' } }],
        summary: { id: 'log-x' },
      })),
    ).rejects.toThrow('HTTP 500')

    expect(d.persist).not.toHaveBeenCalled()
  })

  it('does not PUT when the build throws', async () => {
    const d = deps()
    const engine = new WriteEngine(d)
    await expect(
      engine.write(() => {
        throw new Error('bad build')
      }),
    ).rejects.toThrow('bad build')
    expect(d.put).not.toHaveBeenCalled()
    expect(d.persist).not.toHaveBeenCalled()
  })

  it('serializes concurrent writes through a queue (refresh -> put per write, in order)', async () => {
    const d = deps()
    const engine = new WriteEngine(d)
    const order: string[] = []

    const p1 = engine.write((snap) => {
      order.push(`build-1:${Object.keys(snap.entities.log).length}`)
      return { changes: [{ collection: 'log', entity: { id: 'log-1' } }], summary: 1 }
    })
    // Second write fires before the first resolves.
    const p2 = engine.write((snap) => {
      order.push(`build-2:${Object.keys(snap.entities.log).length}`)
      return { changes: [{ collection: 'log', entity: { id: 'log-2' } }], summary: 2 }
    })

    await Promise.all([p1, p2])
    expect(d.refresh).toHaveBeenCalledTimes(2)
    expect(d.put).toHaveBeenCalledTimes(2)
    // Each write refreshed BEFORE its own PUT, and builds saw the refreshed
    // (pre-merge) snapshot — no write ever built from a mid-write snapshot.
    expect(order[0]).toBe('build-1:1')
    expect(order[1]).toBe('build-2:1')
  })

  it('keeps the queue moving after a failed write', async () => {
    const d = deps()
    const engine = new WriteEngine(d)
    const failing = engine.write(() => {
      throw new Error('boom')
    })
    const succeeding = engine.write(() => ({
      changes: [{ collection: 'log', entity: { id: 'log-ok' } }],
      summary: 'ok',
    }))

    await expect(failing).rejects.toThrow('boom')
    await expect(succeeding).resolves.toBe('ok')
    expect(d.put).toHaveBeenCalledTimes(1)
  })

  it('sends all collections in the envelope (unchanged ones empty)', async () => {
    const d = deps()
    const engine = new WriteEngine(d)
    await engine.write(() => ({
      changes: [{ collection: 'template', entity: { id: 'tpl-1' } }],
      summary: {},
    }))
    const envelope = d.put.mock.calls[0][0]
    for (const collection of COLLECTIONS) {
      expect(envelope._embedded[collection]).toEqual(
        collection === 'template' ? [{ id: 'tpl-1' }] : [],
      )
    }
  })
})
