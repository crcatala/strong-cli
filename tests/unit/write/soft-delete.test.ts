import { describe, expect, it } from 'vitest'
import { makeClock } from '../../../src/write/ids.js'
import { softDelete } from '../../../src/write/soft-delete.js'
import type { Entity } from '../../../src/write/types.js'
import { asEntityView } from '../../helpers/fixtures.js'

/** A workout-shaped entity with nested cellSetGroup/cellSets/cells. */
function workoutEntity(): Entity {
  return {
    id: 'log-1',
    logType: 'WORKOUT',
    lastChanged: '2026-08-01T00:00:00.000Z',
    _embedded: {
      cellSetGroup: [
        {
          id: 'group-1',
          cellSets: [
            {
              id: 'set-1',
              cells: [{ id: 'cell-1', cellType: 'REPS', value: '10' }],
            },
          ],
        },
      ],
    },
  }
}

describe('softDelete', () => {
  it('flags the entity isHidden and bumps lastChanged', () => {
    const clock = makeClock(() => 1_750_000_000_000)
    const deleted = softDelete(workoutEntity(), clock)
    expect(deleted.isHidden).toBe(true)
    expect(deleted.lastChanged).toBe(new Date(1_750_000_000_000).toISOString())
  })

  it('cascades isHidden through cellSetGroup, cellSets and cells', () => {
    const deleted = asEntityView(softDelete(workoutEntity(), makeClock()))
    const group = deleted._embedded.cellSetGroup[0]
    expect(group.isHidden).toBe(true)
    const set = group.cellSets[0]
    expect(set.isHidden).toBe(true)
    const cell = set.cells[0]
    expect(cell.isHidden).toBe(true)
  })

  it('does not mutate the input entity', () => {
    const entity = workoutEntity()
    softDelete(entity, makeClock())
    expect(entity.isHidden).toBeUndefined()
    const group = asEntityView(entity)._embedded.cellSetGroup[0]
    expect(group.isHidden).toBeUndefined()
  })

  it('is a no-op for entities without cellSetGroup', () => {
    const plain: Entity = { id: 'tpl-1', name: { custom: 'Push Day' } }
    const deleted = softDelete(plain, makeClock())
    expect(deleted.isHidden).toBe(true)
    expect(deleted.id).toBe('tpl-1')
    expect(deleted.name).toEqual({ custom: 'Push Day' })
  })
})
