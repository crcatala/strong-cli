/**
 * Snapshot sync engine — keeps the local snapshot in step with the server.
 *
 * Mirrors strong-mcp's SyncEngine (and this repo's read-side incremental
 * cache): a delta walk resumes from the stored continuation token; a stale
 * cursor (HTTP 4xx — verified 400 live on the read side) triggers a full
 * re-walk; `resync()` fetches pristine server truth WITHOUT persisting, for
 * verifying inferred write shapes after a PUT (later tickets).
 */

import type { StrongClient, UserPagesWalk } from '../api/client.js'
import { ApiError } from '../cli/errors.js'
import { applyPage } from './snapshot.js'
import { emptySnapshot, getSnapshotFilePath, loadSnapshot, saveSnapshot } from './snapshot-store.js'
import { COLLECTIONS, type Snapshot } from './types.js'

export interface SyncEngineOptions {
  client: StrongClient
  userId: string
  /** Override the snapshot file path (tests). */
  snapshotPath?: string
  /** Per-page size for the walk (defaults to the client's 200). */
  limit?: number
}

export class SyncEngine {
  private readonly client: StrongClient
  private readonly userId: string
  private readonly snapshotPath: string
  private readonly limit?: number

  constructor(opts: SyncEngineOptions) {
    this.client = opts.client
    this.userId = opts.userId
    this.snapshotPath = opts.snapshotPath ?? getSnapshotFilePath()
    this.limit = opts.limit
  }

  /**
   * Delta-sync the snapshot: resume from the stored continuation, merge the
   * re-delivered tail (new + edited entities, replace-by-id) and persist. On
   * a rejected/stale cursor (HTTP 4xx) falls back to a full re-walk — the API
   * does not tombstone deletions, so full walks are also the only way to drop
   * removed entities from the snapshot.
   */
  async sync(): Promise<Snapshot> {
    const stored = loadSnapshot(this.userId, this.snapshotPath)
    const snapshot = stored ?? emptySnapshot(this.userId)
    try {
      const walk = await this.walk({ continuation: snapshot.continuation ?? undefined })
      this.merge(snapshot, walk)
      snapshot.continuation = walk.lastNextContinuation || snapshot.continuation
      snapshot.syncedAt = new Date().toISOString()
      saveSnapshot(snapshot, this.snapshotPath)
      return snapshot
    } catch (err) {
      if (stored && snapshot.continuation && isStaleCursor(err)) {
        const fresh = emptySnapshot(this.userId)
        const walk = await this.walk({})
        this.merge(fresh, walk)
        fresh.continuation = walk.lastNextContinuation
        fresh.syncedAt = new Date().toISOString()
        saveSnapshot(fresh, this.snapshotPath)
        return fresh
      }
      throw err
    }
  }

  /**
   * Full re-walk of server truth WITHOUT persisting or mutating shared state.
   * Used to verify inferred write shapes (updateWorkoutSets / deleteMeasurement
   * in later tickets) where the optimistic local snapshot cannot be trusted.
   */
  async resync(): Promise<Snapshot> {
    const snapshot = emptySnapshot(this.userId)
    const walk = await this.walk({})
    this.merge(snapshot, walk)
    snapshot.continuation = walk.lastNextContinuation
    snapshot.syncedAt = new Date().toISOString()
    return snapshot
  }

  private walk(opts: { continuation?: string }): Promise<UserPagesWalk> {
    return this.client.walkUserPages(this.userId, {
      includes: [...COLLECTIONS],
      continuation: opts.continuation,
      limit: this.limit,
    })
  }

  private merge(snapshot: Snapshot, walk: UserPagesWalk): void {
    for (const page of walk.pages) applyPage(snapshot, page)
  }
}

/** A stale continuation cursor surfaces as HTTP 4xx (400 verified live). */
function isStaleCursor(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.statusCode !== undefined &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  )
}
