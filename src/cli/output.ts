import type { CliContext } from './context.js'
import { isCliError } from './errors.js'

let stdoutStream: NodeJS.WritableStream = process.stdout
let stderrStream: NodeJS.WritableStream = process.stderr

export function setOutputStream(stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream) {
  stdoutStream = stdout
  stderrStream = stderr
}

function writeOut(message: string): void {
  stdoutStream.write(`${message}\n`)
}

function writeErr(message: string): void {
  stderrStream.write(`${message}\n`)
}

// ============================================================================
// Status/Progress Messages (stderr)
// ============================================================================

export function logSuccess(ctx: CliContext, message: string): void {
  if (ctx.output.quiet) return
  const prefix = ctx.output.color ? ctx.colors.success(ctx.prefix.ok) : ctx.prefix.ok
  writeErr(`${prefix}${message}`)
}

export function logWarning(ctx: CliContext, message: string): void {
  if (ctx.output.quiet) return
  const prefix = ctx.output.color ? ctx.colors.warning(ctx.prefix.warn) : ctx.prefix.warn
  writeErr(`${prefix}${message}`)
}

export function logError(ctx: CliContext, message: string): void {
  const prefix = ctx.output.color ? ctx.colors.error(ctx.prefix.err) : ctx.prefix.err
  writeErr(`${prefix}${message}`)
}

export function logInfo(ctx: CliContext, message: string): void {
  if (ctx.output.quiet) return
  const prefix = ctx.output.color ? ctx.colors.muted(ctx.prefix.info) : ctx.prefix.info
  writeErr(`${prefix}${message}`)
}

export function logVerbose(ctx: CliContext, message: string): void {
  if (!ctx.output.verbose) return
  writeErr(`${ctx.colors.muted('→')} ${ctx.colors.muted(message)}`)
}

export function logDebug(ctx: CliContext, message: string, data?: unknown): void {
  if (!ctx.output.debug) return
  writeErr(`${ctx.colors.muted('[debug]')} ${message}`)
  if (data !== undefined) {
    const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    for (const line of formatted.split('\n')) {
      writeErr(`${ctx.colors.muted('[debug]')}   ${line}`)
    }
  }
}

// ============================================================================
// Data Output (stdout)
// ============================================================================

export type ColumnConfig = {
  key: string
  header: string
  width?: number
}

export function formatJson<T>(data: T): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Output data to stdout in the configured format.
 */
export function output<T>(
  ctx: CliContext,
  data: T,
  options: {
    formatter?: (data: T) => string
    columns?: ColumnConfig[]
    /** Caller-supplied table renderer (for cli-table3 etc). */
    tableFormatter?: (data: T) => string
  } = {},
): void {
  if (ctx.output.quiet) {
    const items = Array.isArray(data) ? data : [data]
    for (const item of items) {
      if (typeof item === 'object' && item !== null) {
        const id = (item as Record<string, unknown>).id ?? (item as Record<string, unknown>)._id
        if (id !== undefined) writeOut(String(id))
      }
    }
    return
  }

  const { format } = ctx.output
  const { formatter, columns, tableFormatter } = options

  switch (format) {
    case 'json':
      writeOut(formatJson(data))
      break
    case 'table':
      if (tableFormatter) writeOut(tableFormatter(data))
      else if (columns) writeOut(renderSimpleTable(data, columns))
      else writeOut(formatJson(data))
      break
    default:
      if (formatter) writeOut(formatter(data))
      else writeOut(formatJson(data))
      break
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderSimpleTable<T>(data: T, columns: ColumnConfig[]): string {
  const items = Array.isArray(data) ? data : [data]
  if (items.length === 0) return '(no data)'

  const widths = columns.map((col) => {
    const headerWidth = col.header.length
    const maxDataWidth = Math.max(
      ...items.map((item) => formatValue(getNestedValue(item, col.key)).length),
    )
    return col.width ?? Math.max(headerWidth, Math.min(maxDataWidth, 40))
  })

  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join('  ')
  const separator = widths.map((w) => '─'.repeat(w)).join('──')
  const rows = items.map((item) =>
    columns
      .map((col, i) => {
        const value = formatValue(getNestedValue(item, col.key))
        return value.slice(0, widths[i]).padEnd(widths[i])
      })
      .join('  '),
  )

  return [header, separator, ...rows].join('\n')
}

export function outputError(ctx: CliContext, error: unknown): void {
  if (ctx.output.format === 'json' && isCliError(error)) {
    writeErr(formatJson(error.toJSON()))
  } else {
    const message = error instanceof Error ? error.message : String(error)
    logError(ctx, message)
  }

  if (ctx.output.debug && error instanceof Error && error.stack) {
    writeErr('')
    writeErr(ctx.colors.muted('Stack trace:'))
    writeErr(ctx.colors.muted(error.stack))
  }
}
