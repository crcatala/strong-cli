/**
 * Authentication commands:
 *   strong auth login    — interactive (or env-var) login, stores session
 *   strong auth status   — show auth state (source, user, token expiry)
 *   strong auth whoami   — alias for status (commander alias)
 *   strong auth refresh  — force a token refresh
 *   strong auth logout   — clear stored credentials
 */
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { Command } from 'commander'
import { createClient, credentialsFromEnv } from '../api/factory.js'
import { decodeJwt } from '../api/jwt.js'
import type { TokenState } from '../api/token-manager.js'
import type { CliContext } from '../cli/context.js'
import { AuthError } from '../cli/errors.js'
import { logInfo, logSuccess, logVerbose, logWarning, output } from '../cli/output.js'
import { clearSession, formatExpiry, getSessionFilePath, getSessionInfo } from '../config/config.js'

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** Silent password prompt (only works on a TTY). */
async function promptSilent(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      reject(new Error('Cannot prompt silently: stdin is not a TTY'))
      return
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    process.stdout.write(message)

    let input = ''
    const onData = (char: string) => {
      const code = char.charCodeAt(0)
      if (code === 3) {
        cleanup()
        reject(new Error('Cancelled'))
        return
      }
      if (code === 13 || code === 10) {
        cleanup()
        process.stdout.write('\n')
        resolve(input)
        return
      }
      if (code === 127 || code === 8) {
        input = input.slice(0, -1)
        return
      }
      if (code >= 32) input += char
    }
    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    stdin.on('data', onData)
  })
}

function storageLabel(useConfig: boolean): string {
  return useConfig ? `config file (${getSessionFilePath()})` : 'system keyring'
}

export function registerAuthCommand(program: Command, ctx: CliContext): void {
  const auth = program
    .command('auth')
    .description('Manage authentication with strong.app')
    .exitOverride()
    .action(function () {
      this.help()
    })

  // ---- login ---------------------------------------------------------------
  auth
    .command('login')
    .description('Log in to Strong (stores access + refresh tokens)')
    .option(
      '-u, --username <username>',
      'Email or username (defaults to STRONG_USERNAME/STRONG_USER env)',
    )
    .option('--use-config', 'Store session in the config file instead of the system keyring')
    .addHelpText(
      'after',
      `
Examples:
  strong auth login                            # prompt for password (secure)
  strong auth login --use-config               # store session in config file (headless)
  strong auth login -u me@example.com          # with explicit username

Credentials can also come from environment variables:
  STRONG_USERNAME / STRONG_USER   email or username
  STRONG_PASSWORD                 password (never use --password flags)`,
    )
    .action(async (options: { username?: string; useConfig?: boolean }) => {
      logVerbose(ctx, 'Starting login flow...')

      const envCreds = credentialsFromEnv()
      const username = options.username ?? envCreds?.username
      if (!username) {
        throw new AuthError('Missing username — pass --username or set STRONG_USERNAME/STRONG_USER')
      }

      let password: string
      if (envCreds?.password && !options.username) {
        password = envCreds.password
        logVerbose(ctx, 'Using STRONG_PASSWORD from environment')
      } else {
        try {
          password = await promptSilent(`Password for ${username}: `)
        } catch {
          password = await prompt('Password: ')
        }
      }
      if (!password) throw new AuthError('No password provided')

      const client = createClient({ useConfig: options.useConfig })
      logVerbose(ctx, 'POST /auth/login ...')
      const session = await client.login(username, password, randomUUID())

      output(
        ctx,
        {
          ok: true,
          userId: session.userId,
          username,
          expiresAt: formatExpiry(session.expiresAt),
          storage: options.useConfig ? 'config' : 'keyring',
        },
        {
          formatter: () =>
            `✓ Logged in as ${username} (user ${session.userId})\n  Session stored in ${storageLabel(options.useConfig ?? false)}\n  Access token expires ${formatExpiry(session.expiresAt)}`,
        },
      )
    })

  // ---- status (alias: whoami) -------------------------------------------
  auth
    .command('status')
    .alias('whoami')
    .description('Show authentication status (alias: whoami)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  strong auth status                           # human-readable
  strong auth status --json                    # machine-readable`,
    )
    .action(async (opts: { json?: boolean }) => {
      const info = await getSessionInfo()
      if (!info.state) {
        output(
          ctx,
          { authenticated: false, tokenSource: null },
          {
            formatter: () => 'Not authenticated.\n\nTo authenticate, run:  strong auth login',
          },
        )
        return
      }

      const state = info.state
      const decoded = tryDecode(state)
      const expired = decoded ? decoded.expMs <= Date.now() : false
      // NB: never include accessToken/refreshToken in output — they are live
      // credentials and must not be printed to stdout/logs.
      const status = {
        authenticated: true,
        source: info.storage,
        username: state.username ?? 'unknown',
        userId: state.userId,
        expiresAt: formatExpiry(state.expiresAt),
      }

      if (opts.json || ctx.output.format === 'json') {
        output(ctx, status)
        return
      }
      output(
        ctx,
        {
          authenticated: true,
          username: state.username ?? 'unknown',
          userId: state.userId,
          source: info.storage,
          expiresAt: formatExpiry(state.expiresAt),
          expiresSoon: expired ? 'EXPIRED — will refresh on next command' : 'ok',
        },
        {
          formatter: (data) =>
            `✓ Authenticated\n\n  User:   ${data.username}\n  UserId: ${data.userId}\n  Source: ${data.source}\n  Expiry: ${data.expiresAt}${expired ? ' (expired)' : ''}`,
        },
      )
    })

  // ---- refresh -------------------------------------------------------------
  auth
    .command('refresh')
    .description('Force a token refresh against the API')
    .addHelpText('after', '\nExamples:\n  strong auth refresh')
    .action(async () => {
      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
      logVerbose(ctx, 'POST /auth/login/refresh ...')
      const token = await client.tokenManager.forceRefresh()
      const next = await client.tokenManager.load()
      output(
        ctx,
        { ok: true, expiresAt: formatExpiry(next?.expiresAt ?? 0) },
        { formatter: () => `✓ Token refreshed (expires ${formatExpiry(next?.expiresAt ?? 0)})` },
      )
      logInfo(ctx, `token prefix: ${token.slice(0, 12)}`)
    })

  // ---- logout --------------------------------------------------------------
  auth
    .command('logout')
    .alias('clear')
    .description('Remove stored credentials')
    .addHelpText('after', '\nExamples:\n  strong auth logout')
    .action(async () => {
      await clearSession()
      logSuccess(ctx, 'Credentials cleared.')
      output(
        ctx,
        { ok: true, message: 'Credentials cleared' },
        {
          formatter: () => '✓ Credentials cleared.',
        },
      )
      if (process.env['STRONG_ACCESS_TOKEN']) {
        logWarning(ctx, 'STRONG_ACCESS_TOKEN env var is still set.')
      }
    })
}

function tryDecode(state: TokenState): { expMs: number } | null {
  try {
    return decodeJwt(state.accessToken)
  } catch {
    return null
  }
}
