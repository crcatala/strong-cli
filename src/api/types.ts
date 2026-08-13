/**
 * TypeScript types for the undocumented Strong (strong.app) backend API.
 *
 * The Strong app backend is a HAL-style REST API. Resources are returned
 * with `_links` (rels for related resources + pagination) and `_embedded`
 * (nested resources). See docs/api-inventory.md and docs/data-model.md for
 * the full reverse-engineered map.
 */

// ============================================================================
// Auth
// ============================================================================

export interface LoginRequest {
  usernameOrEmail: string
  password: string
  deviceId?: string
}

export interface RefreshRequest {
  accessToken: string
  refreshToken: string
  deviceId?: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  userId: string
}

// ============================================================================
// HAL primitives
// ============================================================================

export interface Link {
  href: string
  templated?: boolean
}

export interface HalLinks {
  self?: Link
  next?: Link
  continuation?: Link
  [rel: string]: unknown
}

export interface LocalizedName {
  en?: string
  custom?: string
}

// ============================================================================
// Measurements (exercise definitions)
// ============================================================================

export interface Measurement {
  id: string
  _links?: {
    self?: Link
    user?: Link
    tag?: Link[]
    [rel: string]: unknown
  }
  name?: LocalizedName
  instructions?: LocalizedName
  media?: unknown[]
  cellTypeConfigs?: { cellType: string; mandatory?: boolean }[]
  isGlobal?: boolean
  isHidden?: boolean
  measurementType?: string
  created?: string
  lastChanged?: string
  created_at?: string
  updatedAt?: string
}

export interface MeasuredValue {
  id: string
  type: string
  value: number
  isHidden?: boolean
  created?: string
  lastChanged?: string
  _links?: { user?: Link; [rel: string]: unknown }
  [key: string]: unknown
}

export interface MeasurementsResponse {
  _links?: HalLinks & { next?: Link }
  total?: number
  preferences?: { weightUnit?: Record<string, string>; [key: string]: unknown }
  _embedded?: { measurement?: Measurement[]; measuredValue?: MeasuredValue[] }
}

// ============================================================================
// Logs / workouts (raw API shape)
// ============================================================================

export type CellType =
  | 'REPS'
  | 'RPE'
  | 'OTHER_WEIGHT'
  | 'BARBELL_WEIGHT'
  | 'DUMBBELL_WEIGHT'
  | 'WEIGHTED_BODYWEIGHT'
  | 'PLATE_WEIGHT'
  | 'DISTANCE'
  | 'DURATION'
  | 'REST_TIMER'
  | 'NOTE'
  | string

export interface Cell {
  id: string
  cellType: CellType
  value?: string | null
}

export interface CellSet {
  id?: string
  cells: Cell[]
  isCompleted?: boolean | null
}

export interface CellSetGroup {
  id?: string
  _links?: { measurement?: Link; [rel: string]: unknown }
  _embedded?: Record<string, unknown>
  cellSets: CellSet[]
}

export interface RawLog {
  id: string
  _links?: HalLinks
  _embedded?: { cellSetGroup?: CellSetGroup[] }
  name?: LocalizedName | string | null
  logType?: string
  startDate?: string | null
  endDate?: string | null
  timezoneId?: string | null
  notes?: string | null
  created?: string
  lastChanged?: string
}

export interface Template {
  id: string
  name?: LocalizedName | string | null
  _links?: HalLinks
  _embedded?: Record<string, unknown>
  [k: string]: unknown
}

/** Exercise tag (from the user doc `include=tag`). Verified live 2026-08. */
export interface Tag {
  id: string
  name?: LocalizedName | string | null
  color?: string
  isGlobal?: boolean
  created?: string
  _links?: HalLinks & { measurement?: Link[] }
  [k: string]: unknown
}

/** Template folder (from the user doc `include=folder`). Verified live 2026-08. */
export interface Folder {
  id: string
  name?: LocalizedName | string | null
  isGlobal?: boolean
  index?: number
  created?: string
  lastChanged?: string
  _links?: HalLinks & { template?: Link[] }
  [k: string]: unknown
}

export interface UserResponse {
  id: string
  _links?: HalLinks & { next?: Link }
  _embedded?: {
    log?: RawLog[]
    measurement?: Measurement[]
    template?: Template[]
    tag?: Tag[]
    folder?: Folder[]
    widget?: unknown[]
    measuredValue?: unknown[]
    [k: string]: unknown
  }
  username?: string
  email?: string
  name?: string | null
  preferences?: {
    weightUnit?: Record<string, string>
    distanceUnit?: Record<string, string>
    [k: string]: unknown
  }
  created?: string
  lastChanged?: string
  migrated?: string
  [k: string]: unknown
}

// ============================================================================
// Domain model (after transformation)
// ============================================================================

export interface Set {
  /** Weight in the account's preferred unit (kg or lb), or null for bodyweight/duration-only sets */
  weight: number | null
  reps: number | null
  rpe: number | null
  distance: number | null
  duration: string | null
  /** Raw cell types that produced this set (for debugging/formatting) */
  types: string[]
}

export interface Exercise {
  id: string
  name: string
  sets: Set[]
  skippedSets: Set[]
}

export interface Workout {
  id: string
  name: string | null
  startDate: string | null
  endDate: string | null
  timezoneId: string | null
  logType: string
  exercises: Exercise[]
}

/** Lightweight row for lists/statistics. */
export interface WorkoutSummary {
  id: string
  name: string | null
  date: string | null
  startDate: string | null
  endDate: string | null
  timezoneId: string | null
  exercises: number
  completedSets: number
  skippedSets: number
  volume: number
}
