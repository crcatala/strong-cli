import { readFileSync } from 'node:fs'
import { Command, Option } from 'commander'
import { registerAuthCommand } from '../commands/auth.js'
import { registerExercisesCommand } from '../commands/exercises.js'
import { registerExportCommand } from '../commands/export.js'
import { registerFoldersCommand } from '../commands/folders.js'
import { registerStatsCommand } from '../commands/stats.js'
import { registerTagsCommand } from '../commands/tags.js'
import { registerTemplatesCommand } from '../commands/templates.js'
import { registerWorkoutCommand } from '../commands/workout.js'
import { registerWorkoutsCommand } from '../commands/workouts.js'
import type { CliContext } from './context.js'
import { OUTPUT_FORMATS } from './context.js'

// Read the version from package.json so `--version` and the banner never drift
// from the published artifact. The relative path resolves from both src/ (dev,
// via bun/tsx) and dist/ (built), and npm always ships package.json at the root.
const VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

export function createProgram(ctx: CliContext): Command {
  const program = new Command()

  program.configureHelp({
    showGlobalOptions: true,
    styleTitle: (t) => ctx.colors.section(t),
    styleCommandText: (t) => ctx.colors.command(t),
    styleCommandDescription: (t) => ctx.colors.muted(t),
    styleOptionTerm: (t) => ctx.colors.option(t),
    styleOptionDescription: (t) => ctx.colors.muted(t),
    styleArgumentTerm: (t) => ctx.colors.argument(t),
    styleArgumentDescription: (t) => ctx.colors.muted(t),
    styleSubcommandTerm: (t) => ctx.colors.command(t),
    styleSubcommandDescription: (t) => ctx.colors.muted(t),
  })

  program.addHelpText(
    'beforeAll',
    () =>
      `${ctx.colors.banner('strong')} ${ctx.colors.muted(`v${VERSION}`)} — ${ctx.colors.muted(
        'Unofficial CLI for Strong Workout Tracker (read-only spike)',
      )}\n`,
  )

  const formatExample = (cmd: string, desc: string) =>
    `  ${ctx.colors.command(cmd)}\n    ${ctx.colors.muted(desc)}`

  program.addHelpText(
    'afterAll',
    () => `
${ctx.colors.section('Examples')}
${formatExample('strong auth login', 'Authenticate with your Strong account')}
${formatExample('strong workouts', 'List recent workouts')}
${formatExample('strong workout <id>', 'Show a single workout in detail')}
${formatExample('strong exercises --search squat', 'Search the exercise library')}
${formatExample('strong templates', 'List routine templates')}
${formatExample('strong folders', 'List template folders')}
${formatExample('strong tags', 'List exercise tags')}
${formatExample('strong stats --weeks 12', 'Volume/set statistics')}
${formatExample('strong export -o strong-export.json', 'Export everything to JSON')}

${ctx.colors.section('Output Formats')}
  ${ctx.colors.option('--json')}     ${ctx.colors.muted('Machine-readable JSON (default when piped)')}
  ${ctx.colors.option('--plain')}    ${ctx.colors.muted('Human-readable text (default in terminal)')}
  ${ctx.colors.option('--table')}    ${ctx.colors.muted('Tabular data display')}
  ${ctx.colors.option('--quiet')}    ${ctx.colors.muted('Minimal output (just IDs)')}

${ctx.colors.section('Environment Variables')}
  ${ctx.colors.option('STRONG_USERNAME' + ' / STRONG_USER')}  ${ctx.colors.muted('Login username/email')}
  ${ctx.colors.option('STRONG_PASSWORD')}    ${ctx.colors.muted('Login password (env-only, never a flag)')}
  ${ctx.colors.option('STRONG_ACCESS_TOKEN')}  ${ctx.colors.muted('Bypass login with a raw access token')}
  ${ctx.colors.option('STRONG_REFRESH_TOKEN')} ${ctx.colors.muted('Refresh token (used with the above)')}
  ${ctx.colors.option('STRONG_BACKEND')}   ${ctx.colors.muted('API base URL (default https://back.strong.app)')}
  ${ctx.colors.option('STRONG_FORMAT')}    ${ctx.colors.muted('Default output format (json|plain|table)')}
  ${ctx.colors.option('STRONG_MAX_RETRIES')}  ${ctx.colors.muted('Retries for transient errors (default 2)')}
  ${ctx.colors.option('STRONG_RETRY_BACKOFF_MS')}  ${ctx.colors.muted('Base retry backoff in ms (default 250)')}
  ${ctx.colors.option('STRONG_FULL_SYNC_INTERVAL_DAYS')}  ${ctx.colors.muted('Days between full cache re-syncs (default 30)')}
  ${ctx.colors.option('NO_COLOR')}     ${ctx.colors.muted('Disable colors')}
`,
  )

  program
    .name('strong')
    .description('Unofficial CLI for Strong Workout Tracker (strong.app)')
    .version(VERSION)
    .action(() => {
      program.help()
    })

  program
    .addOption(
      new Option('-f, --format <format>', 'Output format')
        .choices(OUTPUT_FORMATS)
        .default(undefined, 'auto (json when piped, plain in terminal)'),
    )
    .option('--json', 'Output as JSON (shorthand for --format json)')
    .option('--plain', 'Plain text output (shorthand for --format plain)')
    .option('--table', 'Table output (shorthand for --format table)')
    .option('-q, --quiet', 'Minimal output (just IDs)')
    .option('--verbose', 'Show operational progress')
    .option('--debug', 'Show debug information (implies --verbose)')
    .option('--no-color', 'Disable colors (or set NO_COLOR env)')

  registerAuthCommand(program, ctx)
  registerWorkoutsCommand(program, ctx)
  registerWorkoutCommand(program, ctx)
  registerExercisesCommand(program, ctx)
  registerTemplatesCommand(program, ctx)
  registerFoldersCommand(program, ctx)
  registerTagsCommand(program, ctx)
  registerStatsCommand(program, ctx)
  registerExportCommand(program, ctx)

  return program
}
