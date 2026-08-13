import { describe, expect, it } from 'vitest'
import { buildExerciseDefinition } from '../../../src/write/entity-builders.js'
import { makeClock } from '../../../src/write/ids.js'

const clock = makeClock(() => 1_700_000_000_000)

describe('buildExerciseDefinition', () => {
  it('builds the captured custom-exercise shape with defaults', () => {
    const def = buildExerciseDefinition(
      { name: 'Hack Squat', cellTypeConfigs: [{ cellType: 'REPS' }, { cellType: 'RPE' }] },
      'user-1',
      { clock },
    )

    expect(def.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(def.measurementType).toBe('EXERCISE')
    expect(def.name).toEqual({ custom: 'Hack Squat' })
    expect(def.instructions).toEqual({ custom: '' })
    expect(def.notes).toBeNull()
    expect(def.isGlobal).toBe(false)
    expect(def.isHidden).toBe(false)
    expect(def.tools).toEqual([])
    expect(def.created).toBe(clock())
    expect(def.lastChanged).toBe(clock())

    // Per-cell configs carry index + the mandatory/isExponent defaults.
    expect(def.cellTypeConfigs).toEqual([
      { cellType: 'REPS', mandatory: false, isExponent: false, index: 0 },
      { cellType: 'RPE', mandatory: false, isExponent: false, index: 1 },
    ])
  })

  it('honors notes, mandatory/isExponent, and user-scoped tag hrefs', () => {
    const def = buildExerciseDefinition(
      {
        name: 'Pin Press',
        cellTypeConfigs: [
          { cellType: 'REPS', mandatory: true },
          { cellType: 'RPE', isExponent: true },
          { cellType: 'BARBELL_WEIGHT' },
        ],
        notes: 'Chest press from pins',
        tagIds: ['tag-1', 'tag-2'],
      },
      'user-42',
      { clock },
    )

    expect(def.instructions).toEqual({ custom: 'Chest press from pins' })
    expect(def.cellTypeConfigs).toEqual([
      { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
      { cellType: 'RPE', mandatory: false, isExponent: true, index: 1 },
      { cellType: 'BARBELL_WEIGHT', mandatory: false, isExponent: false, index: 2 },
    ])
    expect(def._links?.tag).toEqual([
      { href: '/api/users/user-42/tags/tag-1' },
      { href: '/api/users/user-42/tags/tag-2' },
    ])
  })

  it('emits an empty tag array when no tags are supplied', () => {
    const def = buildExerciseDefinition({ name: 'No Tags', cellTypeConfigs: [] }, 'user-1', {
      clock,
    })
    expect(def._links?.tag).toEqual([])
  })
})
