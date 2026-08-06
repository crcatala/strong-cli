import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runCliMain } from '../../src/cli-main.js'

function harness(argv: string[]) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const exit = vi.fn()
  const setExitCode = vi.fn()
  return {
    stdout,
    stderr,
    exit,
    setExitCode,
    run: () => runCliMain({ argv, env: {}, stdout, stderr, exit, setExitCode }),
  }
}

describe('runCliMain stream error handling', () => {
  it('exits 0 quietly on EPIPE', async () => {
    const h = harness(['--help'])
    await h.run()

    const err = new Error('broken pipe') as NodeJS.ErrnoException
    err.code = 'EPIPE'
    h.stderr.emit('error', err)

    expect(h.exit).toHaveBeenCalledWith(0)
    expect(h.setExitCode).not.toHaveBeenCalled()
  })

  it('exits 1 instead of throwing from a non-EPIPE stream error', async () => {
    const h = harness(['--help'])
    await h.run()

    // A `throw` inside an 'error' event handler would surface as an unhandled
    // rejection that the surrounding try/catch cannot observe. The fix exits.
    const err = new Error('stream closed') as NodeJS.ErrnoException
    err.code = 'EIO'
    h.stderr.emit('error', err)

    expect(h.exit).toHaveBeenCalledWith(1)
    expect(h.setExitCode).not.toHaveBeenCalled()
  })
})
