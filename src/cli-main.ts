import { isCliError } from './cli/errors.js'
import { runCli } from './run.js'

export type CliMainArgs = {
  argv: string[]
  env: Record<string, string | undefined>
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  exit: (code: number) => void
  setExitCode: (code: number) => void
}

function handlePipeErrors(stream: NodeJS.WritableStream, exit: (code: number) => void) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      exit(0)
      return
    }
    // A `throw` inside an event handler becomes an unhandled rejection that
    // the surrounding try/catch cannot observe. Treat stream failures as
    // fatal instead of silently continuing with a broken output stream.
    exit(1)
  })
}

function setupSignalHandlers(stderr: NodeJS.WritableStream, exit: (code: number) => void) {
  let interrupted = false

  process.on('SIGINT', () => {
    if (interrupted) {
      stderr.write('\nForce exiting...\n')
      exit(130)
      return
    }
    interrupted = true
    stderr.write('\nInterrupted. Press Ctrl-C again to force exit.\n')
    setTimeout(() => exit(130), 3000)
  })

  process.on('SIGTERM', () => {
    stderr.write('\nTerminated.\n')
    exit(143)
  })
}

function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Required to strip ANSI escape codes
  return input.replace(/\x1b\[[0-9;]*m/g, '')
}

export async function runCliMain({
  argv,
  env,
  stdout,
  stderr,
  exit,
  setExitCode,
}: CliMainArgs): Promise<void> {
  handlePipeErrors(stdout, exit)
  handlePipeErrors(stderr, exit)
  setupSignalHandlers(stderr, exit)

  const debug = argv.includes('--debug')
  const jsonOutput = argv.includes('--json') || (argv.includes('--format') && argv.includes('json'))

  try {
    await runCli(argv, { env, stdout, stderr })
  } catch (error: unknown) {
    const exitCode = isCliError(error) ? error.exitCode : 1

    if (jsonOutput && isCliError(error)) {
      stderr.write(`${JSON.stringify(error.toJSON(), null, 2)}\n`)
      setExitCode(exitCode)
      return
    }

    if (debug && error instanceof Error && error.stack) {
      stderr.write(`${error.stack}\n`)
      setExitCode(exitCode)
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`${stripAnsi(message)}\n`)
    setExitCode(exitCode)
  }
}
