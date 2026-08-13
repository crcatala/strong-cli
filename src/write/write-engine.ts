/**
 * Serialized write engine for the envelope-PUT protocol.
 *
 * Every write runs: refresh the snapshot (delta sync) -> build the changed
 * entities -> PUT the envelope -> apply the changes optimistically to the
 * snapshot -> persist. Writes are serialized through a promise tail so two
 * concurrent writes never PUT envelopes built from the same stale snapshot.
 * A failed PUT (non-2xx) leaves the snapshot untouched.
 */

import { buildEnvelope } from './envelope.js'
import type { Change, Snapshot, WriteEnvelope } from './types.js'

export interface WriteDeps {
  /** Delta-sync the snapshot (persists) and return it. */
  refresh: () => Promise<Snapshot>
  /** PUT the envelope to the server; throws on non-2xx. */
  put: (envelope: WriteEnvelope) => Promise<void>
  /** Persist the optimistically-updated snapshot. */
  persist: (snapshot: Snapshot) => Promise<void> | void
}

export interface BuildResult<T> {
  changes: Change[]
  summary: T
}

export class WriteEngine {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: WriteDeps) {}

  /** Queue a write: refreshes the snapshot, builds changes, PUTs, merges, persists. */
  write<T>(build: (snapshot: Snapshot) => BuildResult<T>): Promise<T> {
    const run = this.tail.then(
      () => this.runOne(build),
      () => this.runOne(build), // a prior failure must not block this write
    )
    // Swallow so the queue keeps moving even when this write rejects.
    this.tail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  private async runOne<T>(build: (snapshot: Snapshot) => BuildResult<T>): Promise<T> {
    const snapshot = await this.deps.refresh() // delta-sync; cross-links fresh
    const { changes, summary } = build(snapshot)
    const envelope = buildEnvelope(snapshot.userId, changes)
    await this.deps.put(envelope) // throws on non-2xx -> snapshot untouched below
    for (const { collection, entity } of changes) {
      snapshot.entities[collection][entity.id] = entity // idempotent replace by id
    }
    await this.deps.persist(snapshot)
    return summary
  }
}
