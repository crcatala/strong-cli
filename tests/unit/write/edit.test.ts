import { describe, expect, it } from 'vitest'
import { editEntityName } from '../../../src/write/edit.js'
import { makeClock } from '../../../src/write/ids.js'
import type { Entity } from '../../../src/write/types.js'

const clock = makeClock(() => 1_700_000_000_000)

function exercise(name: string): Entity {
  return {
    id: 'ex-1',
    measurementType: 'EXERCISE',
    name: { custom: name },
    instructions: { custom: '' },
    cellTypeConfigs: [{ cellType: 'REPS', mandatory: true, isExponent: false, index: 0 }],
    isGlobal: false,
    isHidden: false,
    created: '2026-01-01T00:00:00.000Z',
    lastChanged: '2026-01-01T00:00:00.000Z',
  }
}

describe('editEntityName', () => {
  it('rewrites name.custom, bumps lastChanged, and preserves every other field', () => {
    const before = exercise('Old Name')
    const after = editEntityName(before, 'New Name', clock)

    expect(after.name).toEqual({ custom: 'New Name' })
    expect(after.lastChanged).toBe(clock())
    expect(after.id).toBe('ex-1')
    expect(after.cellTypeConfigs).toEqual(before.cellTypeConfigs)
    expect(after.isHidden).toBe(false)

    // The source entity must not be mutated (clone semantics).
    expect(before.name).toEqual({ custom: 'Old Name' })
  })

  it('creates name.custom when the entity has no name object', () => {
    const bare = { id: 'ex-2', isHidden: false } as Entity
    const after = editEntityName(bare, 'Branded', clock)
    expect(after.name).toEqual({ custom: 'Branded' })
  })
})
