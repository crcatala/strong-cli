import { CommanderError } from 'commander'
import { createContext, type OutputFormat } from './cli/context.js'
import { setOutputStream } from './cli/output.js'
import { createProgram } from './cli/program.js'
import { setEnv } from './config/config.js'

export type RunEnv = {
  env: Record<string, string | undefined>
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  /** Optional fetch implementation for testing (defaults to globalThis.fetch) */
  fetch?: typeof fetch
}

export async function runCli(
  argv: string[],
  { env, stdout, stderr, fetch: fetchImpl }: RunEnv,
): Promise<void> {
  const fetchFn = fetchImpl ?? globalThis.fetch.bind(globalThis)
  ;(globalThis as unknown as { __strongCliFetch: typeof fetch }).__strongCliFetch = fetchFn

  setOutputStream(stdout, stderr)
  setEnv(env)

  const defaultFormat = env['STRONG_FORMAT'] as OutputFormat | undefined
  const ctx = createContext(argv, env, defaultFormat)
  const program = createProgram(ctx)

  program.configureOutput({
    writeOut: (str) => stdout.write(str),
    writeErr: (str) => stderr.write(str),
  })

  program.exitOverride()

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      const helpOrVersion = ['commander.helpDisplayed', 'commander.version', 'commander.help']
      if (helpOrVersion.includes(error.code)) {
        return
      }
    }
    throw error
  }
}
