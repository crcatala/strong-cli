#!/usr/bin/env node
/**
 * CLI entrypoint - thin shell that injects process dependencies.
 * All logic lives in cli-main.ts for testability.
 */
import { runCliMain } from './cli-main.js'

void runCliMain({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  exit: (code) => process.exit(code),
  setExitCode: (code) => {
    process.exitCode = code
  },
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
