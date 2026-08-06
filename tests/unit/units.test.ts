import { describe, expect, it } from 'vitest'
import {
  distanceLabel,
  distanceToDisplay,
  fmtNumber,
  resolveDistanceUnit,
  resolveWeightUnit,
  weightLabel,
  weightToDisplay,
} from '../../src/lib/units.js'
import { formatVolume } from '../../src/transform/workouts.js'

describe('unit resolution (defaults)', () => {
  it('defaults a missing weight preference to POUNDS', () => {
    expect(resolveWeightUnit(null)).toBe('POUNDS')
    expect(resolveWeightUnit(undefined)).toBe('POUNDS')
    expect(resolveWeightUnit('')).toBe('POUNDS')
    expect(resolveWeightUnit('KILOGRAMS')).toBe('KILOGRAMS')
    expect(resolveWeightUnit('POUNDS')).toBe('POUNDS')
  })

  it('defaults a missing distance preference to MILES', () => {
    expect(resolveDistanceUnit(null)).toBe('MILES')
    expect(resolveDistanceUnit('KILOMETERS')).toBe('KILOMETERS')
    expect(resolveDistanceUnit('METERS')).toBe('METERS')
    expect(resolveDistanceUnit('MILES')).toBe('MILES')
  })
})

describe('weight conversions', () => {
  it('converts kg → lb round-tripping real plate weights', () => {
    // Real captured values: raw API data is canonical kilograms.
    expect(weightToDisplay(22.6796185, 'POUNDS')).toBeCloseTo(50, 4)
    expect(weightToDisplay(20.41165665, 'POUNDS')).toBeCloseTo(45, 4)
    expect(weightToDisplay(100, 'POUNDS')).toBeCloseTo(220.462, 2)
    expect(weightToDisplay(60, 'KILOGRAMS')).toBe(60)
  })

  it('labels weight units', () => {
    expect(weightLabel('POUNDS')).toBe('lb')
    expect(weightLabel('KILOGRAMS')).toBe('kg')
  })
})

describe('distance conversions', () => {
  it('converts meters into the display unit', () => {
    expect(distanceToDisplay(1609.344, 'MILES')).toBeCloseTo(1, 5) // 1 mile
    expect(distanceToDisplay(9977.908, 'MILES')).toBeCloseTo(6.2, 1)
    expect(distanceToDisplay(5000, 'KILOMETERS')).toBeCloseTo(5, 5)
    expect(distanceToDisplay(5000, 'METERS')).toBe(5000)
  })

  it('labels distance units', () => {
    expect(distanceLabel('MILES')).toBe('mi')
    expect(distanceLabel('KILOMETERS')).toBe('km')
    expect(distanceLabel('METERS')).toBe('m')
  })
})

describe('display formatting', () => {
  it('strips trailing zeros and rounds to 2 decimals', () => {
    expect(fmtNumber(50)).toBe('50')
    expect(fmtNumber(22.5)).toBe('22.5')
    expect(fmtNumber(6.2)).toBe('6.2')
    expect(fmtNumber(2.253512)).toBe('2.25')
    expect(fmtNumber(1.9999)).toBe('2')
  })

  it('converts volume (kg·reps) into the display unit', () => {
    // 4 sets of 45 lb × 10 reps = 1800 lb (raw: 4 × 20.41165665 × 10 kg·reps)
    const rawKgVolume = 4 * 20.41165665 * 10
    expect(formatVolume(rawKgVolume, 'POUNDS')).toBe('1,800')
    expect(formatVolume(rawKgVolume, 'KILOGRAMS')).toBe('816')
  })
})
