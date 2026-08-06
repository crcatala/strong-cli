import kleur from 'kleur'

/**
 * Supported output formats.
 * - json: Machine-readable JSON
 * - plain: Human-readable text (default for TTY)
 * - table: Tabular data display
 */
export const OUTPUT_FORMATS = ['json', 'plain', 'table'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export type OutputConfig = {
  color: boolean
  format: OutputFormat
  verbose: boolean
  debug: boolean
  quiet: boolean
}

export type CliContext = {
  isTty: boolean
  output: OutputConfig
  colors: {
    banner: (t: string) => string
    section: (t: string) => string
    command: (t: string) => string
    option: (t: string) => string
    argument: (t: string) => string
    muted: (t: string) => string
    success: (t: string) => string
    warning: (t: string) => string
    error: (t: string) => string
  }
  prefix: {
    ok: string
    warn: string
    err: string
    info: string
  }
}

function resolveOutputConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  isTty: boolean,
  defaultFormat?: OutputFormat,
): OutputConfig {
  const noColor = argv.includes('--no-color') || env.NO_COLOR !== undefined
  const debug = argv.includes('--debug')
  const verbose = argv.includes('--verbose') || debug
  const quiet = argv.includes('--quiet') || argv.includes('-q')

  let format: OutputFormat = isTty ? 'plain' : 'json'

  if (argv.includes('--json')) {
    format = 'json'
  } else if (argv.includes('--plain')) {
    format = 'plain'
  } else if (argv.includes('--table')) {
    format = 'table'
  } else {
    const formatIdx = argv.findIndex((a) => a === '--format' || a === '-f')
    if (formatIdx !== -1 && argv[formatIdx + 1]) {
      const requestedFormat = argv[formatIdx + 1] as OutputFormat
      if (OUTPUT_FORMATS.includes(requestedFormat)) {
        format = requestedFormat
      }
    }
  }

  if (!format && defaultFormat && OUTPUT_FORMATS.includes(defaultFormat)) {
    format = defaultFormat
  }

  const color = isTty && !noColor && format === 'plain'
  return { color, format, verbose, debug, quiet }
}

export function createContext(
  argv: string[],
  env: Record<string, string | undefined>,
  defaultFormat?: OutputFormat,
): CliContext {
  const isTty = process.stdout.isTTY ?? false
  const output = resolveOutputConfig(argv, env, isTty, defaultFormat)

  kleur.enabled = output.color

  const style =
    (styler: (text: string) => string) =>
    (text: string): string =>
      output.color ? styler(text) : text

  const colors = {
    banner: style((t) => kleur.bold().blue(t)),
    section: style((t) => kleur.bold().white(t)),
    command: style((t) => kleur.bold().cyan(t)),
    option: style((t) => kleur.cyan(t)),
    argument: style((t) => kleur.magenta(t)),
    muted: style((t) => kleur.gray(t)),
    success: style((t) => kleur.green(t)),
    warning: style((t) => kleur.yellow(t)),
    error: style((t) => kleur.red(t)),
  }

  const usePlainPrefix = !output.color || output.quiet
  const prefix = usePlainPrefix
    ? { ok: '[OK] ', warn: '[WARN] ', err: '[ERR] ', info: '[INFO] ' }
    : { ok: '✓ ', warn: '⚠ ', err: '✗ ', info: 'ℹ ' }

  return { isTty, output, colors, prefix }
}
