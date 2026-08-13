import { describe, expect, it } from 'vitest'
import { resetEnv } from '../../src/config/config.js'
import { runCli } from '../../src/run.js'
import { createFetchMock, futureJwt, mockResponse } from '../helpers/fixtures.js'

function env(xdg: string): Record<string, string | undefined> {
  return {
    XDG_CONFIG_HOME: xdg,
    STRONG_ACCESS_TOKEN: futureJwt(3600, 'user-1'),
    STRONG_REFRESH_TOKEN: 'rt-1',
    STRONG_USER_ID: 'user-1',
    STRONG_TOKEN_EXPIRES_AT: String(Date.now() + 3_600_000),
  }
}

function harness(_xdg: string) {
  const out: string[] = []
  const err: string[] = []
  const stdout = {
    write: (s: string) => {
      out.push(String(s))
      return true
    },
  } as never
  const stderr = {
    write: (s: string) => {
      err.push(String(s))
      return true
    },
  } as never
  return { out, err, stdout, stderr }
}

describe('measurements command', () => {
  it('lists measured values from the user document and filters by type', async () => {
    const h = harness('/tmp/strong-cli-measurements-command')
    const fetchImpl = createFetchMock([
      {
        match: (url, init) =>
          url.includes('/api/users/user-1') && (init?.method ?? 'GET') === 'GET',
        handler: () =>
          mockResponse({
            id: 'user-1',
            preferences: { weightUnit: { 'user-1': 'POUNDS' } },
            _embedded: {
              measuredValue: [
                {
                  id: 'mv-weight',
                  measurementTypeValue: 'WEIGHT',
                  value: 90.7185,
                  startDate: '2026-01-01',
                },
                {
                  id: 'mv-fat',
                  measurementTypeValue: 'BODY_FAT_PERCENTAGE',
                  value: 0.18,
                  startDate: '2026-01-02',
                },
              ],
            },
          }),
      },
    ])
    await runCli(['measurements', '--type', 'WEIGHT', '--json'], {
      env: env('/tmp/strong-cli-measurements-command'),
      stdout: h.stdout,
      stderr: h.stderr,
      fetch: fetchImpl,
    })
    expect(JSON.parse(h.out.join(''))).toEqual([
      expect.objectContaining({ id: 'mv-weight', type: 'WEIGHT', unit: 'lb' }),
    ])
    expect(JSON.parse(h.out.join(''))[0].value).toBe(200)
    resetEnv()
  })

  it('rejects unknown measurement types before attempting authentication or a write', async () => {
    const h = harness('/tmp/strong-cli-measurements-command-invalid')
    await expect(
      runCli(['measurements', 'add', 'UNKNOWN', '1', '--write'], {
        env: env('/tmp/strong-cli-measurements-command-invalid'),
        stdout: h.stdout,
        stderr: h.stderr,
        fetch: async () => mockResponse({}),
      }),
    ).rejects.toThrow(/Unknown measurement type/)
    resetEnv()
  })
})
