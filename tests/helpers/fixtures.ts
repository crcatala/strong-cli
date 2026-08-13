/**
 * Shared test fixtures — synthetic but shape-accurate Strong API data.
 *
 * The log/user fixtures are fully synthetic (fake ids, fake dates, fake
 * tokens) but reference REAL global measurement ids from
 * captures/measurements_page1.json (the global exercise library is public,
 * non-personal data captured from https://back.strong.app).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenState, TokenStore } from '../../src/api/token-manager.js'
import type { LoginResponse, RawLog, UserResponse } from '../../src/api/types.js'

export function loadCapturedMeasurements(): {
  _embedded?: { measurement?: unknown[] }
} {
  const file = join(import.meta.dirname, '..', '..', 'captures', 'measurements_page1.json')
  return JSON.parse(readFileSync(file, 'utf-8'))
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

/** Create a syntactically valid fake JWT with the given payload claims. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

export function futureJwt(secondsFromNow = 1200, userId = 'test-user-123', jti?: string): string {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow
  const payload: Record<string, unknown> = {
    exp,
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': userId,
  }
  if (jti) payload.jti = jti
  return fakeJwt(payload)
}

// ---------------------------------------------------------------------------
// Auth fixtures
// ---------------------------------------------------------------------------

export function fakeLoginResponse(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    accessToken: futureJwt(),
    refreshToken: 'refresh-token-abc123',
    expiresIn: 1200,
    userId: 'test-user-123',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Token store helper
// ---------------------------------------------------------------------------

/** In-memory TokenStore for tests (mirrors tests/live/mem-store.ts). */
export function memStore(initial: TokenState | null = null): TokenStore {
  let state = initial
  return {
    read: async () => state,
    write: async (s: TokenState) => {
      state = s
    },
  }
}

// ---------------------------------------------------------------------------
// Measurement ids referenced by log fixtures (from the real global library)
// ---------------------------------------------------------------------------

export const MEASUREMENT_IDS = {
  squatMachine: '99afdf73-0e2f-4f2d-a10d-90299196b0db', // Squat (Machine)
  uprightRowDumbbell: '61f41123-654e-45b9-9c3b-fd4cbea9eaf0', // Upright Row (Dumbbell)
  tricepsExtensionCable: '3718fbd6-a0e5-4d56-bb92-10feb3600156', // Triceps Extension (Cable)
  trapBarDeadlift: '57f573f8-f797-4483-bc1f-5911a70463a6', // Trap Bar Deadlift
  sideBend: '3b8b97d5-57eb-427c-85b1-4e9222593a97', // Side Bend (Band)
} as const

// ---------------------------------------------------------------------------
// Log fixtures (synthetic)
// ---------------------------------------------------------------------------

const cell = (cellType: string, value: string) => ({ id: crypto.randomUUID(), cellType, value })

function setGroup(
  measurementId: string,
  sets: { weight?: string; reps?: string; completed?: boolean }[],
) {
  return {
    id: crypto.randomUUID(),
    _links: {
      measurement: {
        href: `/api/users/test-user-123/measurements/${measurementId}`,
      },
    },
    cellSets: sets.map((s) => ({
      id: crypto.randomUUID(),
      cells: [
        ...(s.weight ? [cell('OTHER_WEIGHT', s.weight)] : []),
        ...(s.reps ? [cell('REPS', s.reps)] : []),
      ],
      isCompleted: s.completed ?? true,
    })),
  }
}

export function syntheticLog(overrides: Partial<RawLog> = {}): RawLog {
  return {
    id: 'log-0001',
    _links: {
      self: { href: '/api/logs/test-user-123/log-0001' },
      user: { href: '/api/users/test-user-123' },
    },
    _embedded: {
      cellSetGroup: [
        setGroup(MEASUREMENT_IDS.squatMachine, [
          { weight: '60', reps: '12' },
          { weight: '70', reps: '10' },
          { weight: '80', reps: '8', completed: false },
        ]),
        setGroup(MEASUREMENT_IDS.uprightRowDumbbell, [
          { weight: '20', reps: '12' },
          { weight: '22.5', reps: '10' },
        ]),
      ],
    },
    name: { en: 'Leg Day' },
    logType: 'WORKOUT',
    startDate: '2026-05-04T16:07:54.566Z',
    endDate: '2026-05-04T17:01:58.254Z',
    timezoneId: 'Europe/Berlin',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// User response fixture (synthetic)
// ---------------------------------------------------------------------------

export function syntheticUserResponse(logs: RawLog[] = [syntheticLog()]): UserResponse {
  return {
    id: 'test-user-123',
    _links: { self: { href: '/api/users/test-user-123' } },
    _embedded: { log: logs },
    username: 'test-user',
    email: 'test@example.com',
    preferences: {
      weightUnit: { 'test-user-123': 'KILOGRAMS' },
      distanceUnit: { 'test-user-123': 'KILOMETERS' },
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function mockResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const { status = 200, headers = {} } = options
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body)
  const contentType = typeof body === 'string' ? 'text/plain' : 'application/json'
  return new Response(responseBody, {
    status,
    headers: { 'content-type': contentType, ...headers },
  })
}

export function createFetchMock(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>
  }>,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const route of routes) {
      if (route.match(url, init)) return route.handler(url, init)
    }
    throw new Error(`Unexpected fetch call: ${url}`)
  }
}

export function urlIncludes(part: string) {
  return {
    match: (url: string) => url.includes(part),
    handler: () => mockResponse({ error: 'no route' }, { status: 404 }),
  }
}
