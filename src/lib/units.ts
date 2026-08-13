/**
 * Unit conversion for display.
 *
 * The Strong API stores workout values **canonically in metric units** — set
 * weights arrive in kilograms, distances in meters regardless of the account's
 * preferences (verified live: a raw `22.6796185` = exactly 50 lb, `1609.34` m
 * = exactly 1 mi, while the account reports POUNDS / MILES). The domain model
 * and JSON output keep the raw metric values; display formatting converts.
 *
 * When a preference is missing, the display defaults to **POUNDS / MILES**
 * (the CLI owner's preference); an explicit `KILOGRAMS`/`KILOMETERS`/`METERS`
 * preference overrides it.
 */

import { UsageError } from '../cli/errors.js'

export type WeightUnit = 'KILOGRAMS' | 'POUNDS'
export type DistanceUnit = 'METERS' | 'KILOMETERS' | 'MILES'

/** Partial display-unit override from the `--unit` flag (absent fields keep account prefs). */
export interface DisplayUnitOverride {
  weight?: WeightUnit
  distance?: DistanceUnit
}

/**
 * Parse a `--unit` flag value (`kg|lb|m|km|mi`) into display-unit overrides.
 * Returns `null` when no override was given. Weight values override the
 * weight unit only; distance values the distance unit only — the other unit
 * keeps the account preference. Throws {@link UsageError} on unknown values.
 */
export function parseUnitOverride(value: string | undefined): DisplayUnitOverride | null {
  if (value === undefined) return null
  switch (value) {
    case 'kg':
      return { weight: 'KILOGRAMS' }
    case 'lb':
      return { weight: 'POUNDS' }
    case 'm':
      return { distance: 'METERS' }
    case 'km':
      return { distance: 'KILOMETERS' }
    case 'mi':
      return { distance: 'MILES' }
    default:
      throw new UsageError(`Invalid --unit: ${value} (expected kg, lb, m, km, or mi)`)
  }
}

const LB_PER_KG = 2.2046226218
const M_PER_MI = 1609.344
const M_PER_KM = 1000

export function resolveWeightUnit(v: string | null | undefined): WeightUnit {
  return v === 'KILOGRAMS' ? 'KILOGRAMS' : 'POUNDS'
}

export function resolveDistanceUnit(v: string | null | undefined): DistanceUnit {
  if (v === 'METERS' || v === 'KILOMETERS') return v
  return 'MILES'
}

/** Convert a raw kg value into the display unit. */
export function weightToDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'KILOGRAMS' ? kg : kg * LB_PER_KG
}

/** Convert a display-unit weight into the canonical kg value (write path). */
export function weightToKg(display: number, unit: WeightUnit): number {
  return unit === 'KILOGRAMS' ? display : display / LB_PER_KG
}

/** Convert a raw meter value into the display unit. */
export function distanceToDisplay(meters: number, unit: DistanceUnit): number {
  if (unit === 'KILOMETERS') return meters / M_PER_KM
  if (unit === 'MILES') return meters / M_PER_MI
  return meters
}

export function weightLabel(unit: WeightUnit): string {
  return unit === 'KILOGRAMS' ? 'kg' : 'lb'
}

export function distanceLabel(unit: DistanceUnit): string {
  if (unit === 'KILOMETERS') return 'km'
  if (unit === 'MILES') return 'mi'
  return 'm'
}

/** Format a converted display value: up to 2 decimals, trailing zeros stripped. */
export function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 100) / 100
  const s = String(rounded)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
