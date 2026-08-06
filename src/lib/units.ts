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

export type WeightUnit = 'KILOGRAMS' | 'POUNDS'
export type DistanceUnit = 'METERS' | 'KILOMETERS' | 'MILES'

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
