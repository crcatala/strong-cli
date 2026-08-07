import { describe, expect, it } from 'vitest'
import type { CellSet, RawLog } from '../../src/api/types.js'
import {
  buildMeasurementMap,
  folderName,
  measurementIdFromGroup,
  parseCellSet,
  tagName,
  templateName,
  toSummary,
  transformLog,
  transformLogs,
  workoutVolume,
} from '../../src/transform/workouts.js'
import { loadCapturedMeasurements, MEASUREMENT_IDS, syntheticLog } from '../helpers/fixtures.js'

const cell = (cellType: string, value?: string) => ({ id: 'c1', cellType, value })

describe('parseCellSet', () => {
  it('parses weight + reps', () => {
    const set: CellSet = {
      cells: [cell('OTHER_WEIGHT', '60'), cell('REPS', '12')],
      isCompleted: true,
    }
    expect(parseCellSet(set)).toEqual({
      weight: 60,
      reps: 12,
      rpe: null,
      distance: null,
      duration: null,
      types: ['OTHER_WEIGHT', 'REPS'],
    })
  })

  it('parses dumbbell weight, rpe, distance and duration cells', () => {
    const set: CellSet = {
      cells: [
        cell('DUMBBELL_WEIGHT', '22.5'),
        cell('REPS', '10'),
        cell('RPE', '8.5'),
        cell('DISTANCE', '200'),
        cell('DURATION', '45'),
      ],
    }
    const parsed = parseCellSet(set)
    expect(parsed?.weight).toBe(22.5)
    expect(parsed?.rpe).toBe(8.5)
    expect(parsed?.distance).toBe(200)
    expect(parsed?.duration).toBe('45')
  })

  it('returns null for rest-timer and note rows', () => {
    expect(parseCellSet({ cells: [cell('REST_TIMER', '90')] })).toBeNull()
    expect(parseCellSet({ cells: [cell('NOTE', 'went heavy')] })).toBeNull()
  })

  it('returns null for an empty cell set', () => {
    expect(parseCellSet({ cells: [] })).toBeNull()
  })
})

describe('transformLogs', () => {
  it('transforms a log into the domain model with names resolved', () => {
    const map = new Map([
      [MEASUREMENT_IDS.squatMachine, 'Squat (Machine)'],
      [MEASUREMENT_IDS.uprightRowDumbbell, 'Upright Row (Dumbbell)'],
    ])
    const workout = transformLog(syntheticLog(), map)
    expect(workout.name).toBe('Leg Day')
    expect(workout.logType).toBe('WORKOUT')
    expect(workout.exercises).toHaveLength(2)
    expect(workout.exercises[0].name).toBe('Squat (Machine)')
    expect(workout.exercises[0].sets).toHaveLength(2) // third set is skipped (isCompleted: false)
    expect(workout.exercises[0].skippedSets).toHaveLength(1)
    expect(workoutVolume(workout)).toBe(60 * 12 + 70 * 10 + 20 * 12 + 22.5 * 10)
  })

  it('filters non-workout logs', () => {
    const map = new Map<string, string>()
    const logs: RawLog[] = [
      syntheticLog(),
      { ...syntheticLog({ id: 'log-0002' }), logType: 'NOTE' },
    ]
    const workouts = transformLogs(logs, map)
    expect(workouts).toHaveLength(1)
  })

  it('uses the measurement id as fallback name', () => {
    const workout = transformLog(syntheticLog(), new Map())
    expect(workout.exercises[0].name).toBe(MEASUREMENT_IDS.squatMachine)
  })
})

describe('buildMeasurementMap', () => {
  it('resolves real captured global measurement names', () => {
    const captured = loadCapturedMeasurements()
    const measurements = (captured._embedded?.measurement ?? []) as Parameters<
      typeof buildMeasurementMap
    >[0]
    const map = buildMeasurementMap(measurements)
    expect(map.get(MEASUREMENT_IDS.squatMachine)).toBe('Squat (Machine)')
    expect(map.get(MEASUREMENT_IDS.trapBarDeadlift)).toBe('Trap Bar Deadlift')
    expect(map.size).toBeGreaterThan(10)
  })

  it('user custom names override global names', () => {
    const global = [{ id: 'm1', name: { en: 'Bench Press' } }] as Parameters<
      typeof buildMeasurementMap
    >[0]
    const user = [
      { id: 'm1', name: { en: 'Bench Press', custom: 'Bench (my variation)' } },
    ] as Parameters<typeof buildMeasurementMap>[1]
    const map = buildMeasurementMap(global, user)
    expect(map.get('m1')).toBe('Bench (my variation)')
  })
})

describe('measurementIdFromGroup', () => {
  it('extracts id from the measurement link', () => {
    expect(
      measurementIdFromGroup({
        _links: { measurement: { href: '/api/users/u/measurements/abc-123' } },
        cellSets: [],
      }),
    ).toBe('abc-123')
  })
})

describe('toSummary', () => {
  it('aggregates counts and volume', () => {
    const map = new Map([[MEASUREMENT_IDS.squatMachine, 'Squat (Machine)']])
    const workout = transformLog(syntheticLog(), map)
    const summary = toSummary(workout)
    expect(summary.exercises).toBe(2)
    expect(summary.completedSets).toBe(4)
    expect(summary.skippedSets).toBe(1)
    expect(summary.volume).toBe(60 * 12 + 70 * 10 + 20 * 12 + 22.5 * 10)
  })
})

describe('name helpers (templates/tags/folders)', () => {
  it('templateName prefers custom, then en, then the id', () => {
    const t = { id: 'tpl-1' }
    expect(templateName({ ...t, name: { custom: 'My Push' } })).toBe('My Push')
    expect(templateName({ ...t, name: { en: 'Push Day' } })).toBe('Push Day')
    expect(templateName({ ...t, name: 'Plain Name' })).toBe('Plain Name')
    expect(templateName(t)).toBe('tpl-1')
  })

  it('tagName and folderName follow the same fallback', () => {
    expect(tagName({ id: 'arms', name: { en: 'ARMS' } })).toBe('ARMS')
    expect(tagName({ id: 'arms', name: null })).toBe('arms')
    expect(folderName({ id: 'example-templates', name: { en: 'Example Templates' } })).toBe(
      'Example Templates',
    )
    expect(folderName({ id: 'f-1' })).toBe('f-1')
  })
})
