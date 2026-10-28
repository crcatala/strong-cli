import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const runUpdate = vi.hoisted(() => vi.fn())

vi.mock('../../src/cli-meta.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/cli-meta.js')>()
  return { ...actual, runUpdate }
})

const { runCli } = await import('../../src/run.js')

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string
}

function harness(env: Record<string, string | undefined> = {}) {
  const out: string[] = []
  const err: string[] = []
  const stream = (sink: string[]) =>
    ({
      write: (s: string) => {
        sink.push(String(s))
        return true
      },
    }) as unknown as NodeJS.WritableStream
  return {
    out,
    err,
    run: (argv: string[]) =>
      runCli(argv, {
        env: { STRONG_DISABLE_KEYRING: '1', ...env },
        stdout: stream(out),
        stderr: stream(err),
      }),
  }
}

afterEach(() => {
  runUpdate.mockReset()
  process.exitCode = undefined
})

describe('strong --version', () => {
  it('prints the release-standard line', async () => {
    const h = harness()
    await h.run(['--version'])

    expect(h.out.join('').trim()).toMatch(
      /^strong \d+\.\d+\.\d+ \([0-9a-f]{7}(-dirty)? \d{4}-\d{2}-\d{2}\)$/,
    )
  })

  it('answers -V with the same line', async () => {
    const h = harness()
    await h.run(['-V'])
    expect(h.out.join('').trim()).toContain(`strong ${pkg.version} (`)
  })
})

describe('strong version', () => {
  it('prints one JSON object when piped or with --json', async () => {
    const h = harness()
    await h.run(['version', '--json'])

    const details = JSON.parse(h.out.join('')) as Record<string, unknown>
    expect(details.version).toBe(pkg.version)
    expect(details.install).toBe('checkout')
    expect(String(details.commit)).toMatch(/^[0-9a-f]{40}$/)
    expect(details.path).toContain('strong-cli')
  })

  it('prints key: value lines with --plain', async () => {
    const h = harness()
    await h.run(['version', '--plain'])

    const lines = h.out.join('').trim().split('\n')
    expect(lines[0]).toBe(`version: ${pkg.version}`)
    expect(lines.some((line) => line.startsWith('commit: '))).toBe(true)
    expect(lines.some((line) => line.startsWith('install: '))).toBe(true)
  })
})

describe('strong update', () => {
  it('sets the exit code the update check reports', async () => {
    runUpdate.mockReturnValueOnce(1)
    const h = harness()
    await h.run(['update', '--check'])

    expect(runUpdate).toHaveBeenCalledWith('strong', expect.objectContaining({ check: true }))
    expect(process.exitCode).toBe(1)
  })

  it('passes --force through and exits 0 when the update succeeds', async () => {
    runUpdate.mockReturnValueOnce(0)
    const h = harness()
    await h.run(['update', '--force'])

    expect(runUpdate).toHaveBeenCalledWith('strong', expect.objectContaining({ force: true }))
    expect(process.exitCode).toBe(0)
  })

  it('is listed in the help output', async () => {
    const h = harness()
    await h.run(['--help'])
    expect(h.out.join('')).toContain('update')
    expect(h.out.join('')).toContain('version')
  })
})
