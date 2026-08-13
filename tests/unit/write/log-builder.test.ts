import { describe, expect, it } from 'vitest'
import { makeClock } from '../../../src/write/ids.js'
import { buildLog, restSeconds } from '../../../src/write/log-builder.js'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import type { Snapshot } from '../../../src/write/types.js'
import { asEntityView } from '../../helpers/fixtures.js'

const clock = makeClock(() => 1_700_000_000_000)

function snapshot(
  measurements: Record<string, unknown> = {},
  prefs: Record<string, unknown> = {},
): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(measurements)) {
    s.entities.measurement[id] = entity as never
  }
  s.preferences = prefs
  return s
}

const squat = {
  id: 'ex-1',
  measurementType: 'EXERCISE',
  name: { custom: 'Squat' },
  cellTypeConfigs: [
    { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
    { cellType: 'BARBELL_WEIGHT', mandatory: false, isExponent: false, index: 1 },
    { cellType: 'RPE', mandatory: false, isExponent: true, index: 2 },
  ],
}

describe('buildLog (TEMPLATE)', () => {
  it('builds a TEMPLATE entity with cellSetGroup derived from cellTypeConfigs', () => {
    const s = snapshot({ 'ex-1': squat })
    const t = asEntityView(
      buildLog(
        'TEMPLATE',
        {
          name: 'Push Day',
          exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 60, rpe: 8 }] }],
        },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    )

    expect(t.logType).toBe('TEMPLATE')
    expect(t.name).toEqual({ custom: 'Push Day' })
    expect(t.isHidden).toBe(false)
    expect(t.isArchived).toBe(false)
    expect(t.access).toBe('PRIVATE')
    expect(t._links.user).toEqual({ href: '/api/users/user-1' })
    // TEMPLATE has no startDate/endDate and no template link.
    expect(t.startDate).toBeUndefined()
    expect(t.endDate).toBeUndefined()
    expect(t._links.template).toBeUndefined()

    const group = t._embedded.cellSetGroup[0]
    expect(group._links?.measurement).toEqual({ href: '/api/users/user-1/measurements/ex-1' })
    expect(group.isHidden).toBe(false)
    // One working set + one trailing REST_TIMER set.
    expect(group.cellSets).toHaveLength(2)

    const working = group.cellSets[0]
    expect(working.isCompleted).toBe(false) // templates are not completed
    expect(working.cells).toEqual([
      expect.objectContaining({ cellType: 'REPS', value: '10' }),
      expect.objectContaining({ cellType: 'BARBELL_WEIGHT', value: '60' }),
      expect.objectContaining({ cellType: 'RPE', value: '8' }),
    ])

    const rest = group.cellSets[1]
    expect(rest.cells).toEqual([expect.objectContaining({ cellType: 'REST_TIMER' })])
  })

  it('converts display-unit weights to kg on the wire', () => {
    const s = snapshot({ 'ex-1': squat })
    const t = asEntityView(
      buildLog(
        'TEMPLATE',
        { name: 'Lb Day', exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 5, weight: 220 }] }] },
        s,
        { clock, weightUnit: 'POUNDS' },
      ),
    )
    const weightCell = t._embedded.cellSetGroup[0].cellSets[0].cells.find(
      (c: { cellType: string }) => c.cellType === 'BARBELL_WEIGHT',
    )
    // 220 lb ≈ 100 kg (LB_PER_KG ≈ 2.20462).
    expect(Number(weightCell?.value)).toBeCloseTo(100, 0)
  })

  it('writes null RPE when rpe is omitted', () => {
    const s = snapshot({ 'ex-1': squat })
    const t = asEntityView(
      buildLog(
        'TEMPLATE',
        { name: 'No RPE', exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 60 }] }] },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    )
    const rpeCell = t._embedded.cellSetGroup[0].cellSets[0].cells.find(
      (c: { cellType: string }) => c.cellType === 'RPE',
    )
    expect(rpeCell?.value).toBeNull()
  })

  it('throws for an exercise id absent from the snapshot', () => {
    const s = snapshot({})
    expect(() =>
      buildLog(
        'TEMPLATE',
        { name: 'X', exercises: [{ exerciseId: 'missing', sets: [{ reps: 10, weight: 0 }] }] },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    ).toThrow(/Unknown exercise id "missing"/)
  })

  it('throws for an archived (hidden) exercise — it must not resolve for new writes', () => {
    const archived = { ...squat, isHidden: true }
    const s = snapshot({ 'ex-1': archived })
    expect(() =>
      buildLog(
        'TEMPLATE',
        { name: 'X', exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 0 }] }] },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    ).toThrow(/Archived exercise id "ex-1"/)
  })

  it('throws for a cell type it cannot write (e.g. DISTANCE)', () => {
    const cardio = {
      id: 'ex-2',
      cellTypeConfigs: [{ cellType: 'DISTANCE', mandatory: true, isExponent: false, index: 0 }],
    }
    const s = snapshot({ 'ex-2': cardio })
    expect(() =>
      buildLog(
        'TEMPLATE',
        { name: 'Cardio', exercises: [{ exerciseId: 'ex-2', sets: [{ reps: 1, weight: 0 }] }] },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    ).toThrow(/Refusing to write unknown cell type "DISTANCE"/)
  })

  it('handles OTHER_WEIGHT exercises (the common machine case)', () => {
    const machine = {
      id: 'ex-3',
      cellTypeConfigs: [
        { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
        { cellType: 'OTHER_WEIGHT', mandatory: false, isExponent: false, index: 1 },
      ],
    }
    const s = snapshot({ 'ex-3': machine })
    const t = asEntityView(
      buildLog(
        'TEMPLATE',
        { name: 'Machine', exercises: [{ exerciseId: 'ex-3', sets: [{ reps: 12, weight: 40 }] }] },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    )
    const weightCell = t._embedded.cellSetGroup[0].cellSets[0].cells.find(
      (c: { cellType: string }) => c.cellType === 'OTHER_WEIGHT',
    )
    expect(weightCell?.value).toBe('40')
  })
})

describe('buildLog (WORKOUT)', () => {
  it('adds startDate/endDate and an optional template link', () => {
    const s = snapshot({ 'ex-1': squat })
    const t = asEntityView(
      buildLog(
        'WORKOUT',
        {
          name: 'Leg Day',
          templateId: 'tpl-1',
          exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 60 }] }],
        },
        s,
        { clock, weightUnit: 'KILOGRAMS' },
      ),
    )
    expect(t.logType).toBe('WORKOUT')
    expect(t.startDate).toBe(clock())
    expect(t.endDate).toBe(clock())
    expect(t._links.template).toEqual({ href: '/api/users/user-1/templates/tpl-1' })
    expect(t._embedded.cellSetGroup[0].cellSets[0].isCompleted).toBe(true)
  })
})

describe('restSeconds', () => {
  it('reads the per-exercise rest timer from preferences, defaulting to 85', () => {
    const s = snapshot({}, { restTimer: { 'ex-1': 120 } })
    expect(restSeconds(s, 'ex-1')).toBe('120')
    expect(restSeconds(s, 'ex-unknown')).toBe('85')
  })
})
