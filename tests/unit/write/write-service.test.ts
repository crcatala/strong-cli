import { describe, expect, it, vi } from 'vitest'
import { makeClock } from '../../../src/write/ids.js'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import type { Snapshot } from '../../../src/write/types.js'
import { type WriteDeps, WriteEngine } from '../../../src/write/write-engine.js'
import { EntityNotFoundError, ExerciseWriteService } from '../../../src/write/write-service.js'

const clock = makeClock(() => 1_700_000_000_000)

function snapshot(measurements: Record<string, unknown> = {}): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(measurements)) {
    s.entities.measurement[id] = entity as never
  }
  return s
}

function deps(measurements: Record<string, unknown> = {}): WriteDeps & {
  put: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(async () => snapshot(measurements))
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist }
}

function service(d: WriteDeps): ExerciseWriteService {
  return new ExerciseWriteService({ engine: new WriteEngine(d), clock, userId: 'user-1' })
}

describe('ExerciseWriteService', () => {
  it('createExercise PUTs a built measurement entity and returns id + name', async () => {
    const d = deps()
    const res = await service(d).createExercise({
      name: 'Hack Squat',
      cellTypeConfigs: [{ cellType: 'REPS', mandatory: true }],
      notes: 'deep',
      tagIds: ['tag-1'],
    })

    expect(res.name).toBe('Hack Squat')
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)

    const envelope = d.put.mock.calls[0][0]
    expect(envelope.id).toBe('user-1')
    expect(envelope._embedded.measurement).toHaveLength(1)
    const sent = envelope._embedded.measurement[0]
    expect(sent.id).toBe(res.id)
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
    expect(sent.measurementType).toBe('EXERCISE')
    expect(sent.isHidden).toBe(false)
    // All unchanged collections are sent as empty arrays.
    expect(envelope._embedded.template).toEqual([])
    expect(envelope._embedded.log).toEqual([])
  })

  it('updateExerciseName rewrites name.custom on the envelope entity', async () => {
    const existing = {
      id: 'ex-1',
      name: { custom: 'Old Name' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const d = deps({ 'ex-1': existing })
    const res = await service(d).updateExerciseName('ex-1', 'New Name')

    expect(res).toEqual({ id: 'ex-1' })
    const sent = d.put.mock.calls[0][0]._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.name).toEqual({ custom: 'New Name' })
    expect(sent.lastChanged).toBe(clock())
  })

  it('updateExerciseName throws EntityNotFoundError for unknown ids and skips the PUT', async () => {
    const d = deps({})
    await expect(service(d).updateExerciseName('ex-missing', 'X')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })

  it('updateExerciseName refuses archived (hidden) definitions', async () => {
    const d = deps({
      'ex-archived': { id: 'ex-archived', name: { custom: 'Gone' }, isHidden: true },
    })
    await expect(service(d).updateExerciseName('ex-archived', 'X')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })

  it('archiveExercise soft-deletes (isHidden cascade) on the envelope entity', async () => {
    const existing = {
      id: 'ex-1',
      name: { custom: 'Hack Squat' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const d = deps({ 'ex-1': existing })
    const res = await service(d).archiveExercise('ex-1')

    expect(res).toEqual({ id: 'ex-1', archived: true })
    const sent = d.put.mock.calls[0][0]._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.isHidden).toBe(true)
    expect(sent.lastChanged).toBe(clock())
    // Soft delete keeps the rest of the entity intact.
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
  })

  it('archiveExercise throws EntityNotFoundError for unknown ids', async () => {
    const d = deps({})
    await expect(service(d).archiveExercise('ex-missing')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })
})
