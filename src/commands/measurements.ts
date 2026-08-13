/** `strong measurements` — list and manage body measurements. */
import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { MeasuredValue, UserResponse } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, logWarning, output } from '../cli/output.js'
import { resolveWeightUnit, type WeightUnit, weightLabel, weightToDisplay } from '../lib/units.js'
import { MEASURED_VALUE_TYPES, type MeasuredValueType } from '../write/entity-builders.js'
import { makeClock } from '../write/ids.js'
import { saveSnapshot } from '../write/snapshot-store.js'
import { SyncEngine } from '../write/sync-engine.js'
import { WriteEngine } from '../write/write-engine.js'
import { EntityNotFoundError, MeasuredValueWriteService } from '../write/write-service.js'

const WRITE_WARNING = `
WARNING: this is an experimental write against an undocumented,
community-reverse-engineered API. Only use writes on a DISPOSABLE test account.
This subcommand requires the explicit --write flag.

Body measurement deletion is an inferred API shape and always re-syncs to
verify whether Strong accepted the soft-delete.
`

function parseType(raw: string): MeasuredValueType {
  const type = raw.trim().toUpperCase()
  if (!MEASURED_VALUE_TYPES.includes(type as MeasuredValueType)) {
    throw new UsageError(
      `Unknown measurement type "${raw}" — expected ${MEASURED_VALUE_TYPES.join(', ')}`,
    )
  }
  return type as MeasuredValueType
}

function parseValue(raw: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0)
    throw new UsageError(`Invalid measurement value: ${raw}`)
  return value
}

function requireWriteOptIn(write: boolean | undefined): void {
  if (!write) {
    throw new UsageError(
      'writes are opt-in: add --write to acknowledge the ToS/risk warning (see `strong measurements add --help`)',
    )
  }
}

async function createMeasuredValueWriteService() {
  const client = createClient()
  const session = await client.tokenManager.load()
  if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
  const sync = new SyncEngine({ client, userId: session.userId })
  const engine = new WriteEngine({
    refresh: () => sync.sync(),
    put: (envelope) => client.putEnvelope(session.userId, envelope),
    persist: (snapshot) => saveSnapshot(snapshot),
  })
  return new MeasuredValueWriteService({
    engine,
    clock: makeClock(),
    userId: session.userId,
    resync: () => sync.resync(),
    reconcile: (fresh) => saveSnapshot(fresh),
  })
}

function displayValue(
  measurement: MeasuredValue,
  weightUnit: WeightUnit,
): { value: number; unit: string } {
  if (measurement.measurementTypeValue === 'WEIGHT')
    return {
      value: Math.round(weightToDisplay(measurement.value, weightUnit) * 10) / 10,
      unit: weightLabel(weightUnit),
    }
  if (measurement.measurementTypeValue === 'BODY_FAT_PERCENTAGE') {
    return { value: Math.round(measurement.value * 1000) / 10, unit: '%' }
  }
  return { value: measurement.value, unit: 'kcal' }
}

function wrapWriteError(err: unknown): never {
  if (err instanceof EntityNotFoundError) {
    throw new UsageError(
      `Unknown measurement id "${err.id}" — not found in your account (it may already be deleted)`,
    )
  }
  throw err
}

export function registerMeasurementsCommand(program: Command, ctx: CliContext): void {
  const measurements = program
    .command('measurements')
    .description('List body measurements')
    .option('-t, --type <type>', 'Filter by type (WEIGHT, BODY_FAT_PERCENTAGE, CALORIC_INTAKE)')
    .addHelpText(
      'after',
      `
Examples:
  strong measurements
  strong measurements --type WEIGHT --table
  strong measurements add WEIGHT 180 --write
  strong measurements delete <id> --write
${WRITE_WARNING}`,
    )
    .action(async (options: { type?: string }) => {
      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
      const filter = options.type ? parseType(options.type) : undefined
      logVerbose(ctx, 'Fetching body measurements...')
      const response = await client.getUser(session.userId, { includes: ['measuredValue'] })
      const weightUnit = resolveWeightUnit(response.preferences?.weightUnit?.[session.userId])
      const rows = ((response as UserResponse)._embedded?.measuredValue ?? [])
        .filter((m) => m.isHidden !== true && (!filter || m.measurementTypeValue === filter))
        .map((m) => ({
          id: m.id,
          type: m.measurementTypeValue,
          ...displayValue(m, weightUnit),
          date: m.startDate,
          created: m.created,
          lastChanged: m.lastChanged,
        }))
      output(ctx, rows, {
        formatter: () =>
          rows.length
            ? rows.map((r) => `${r.type}: ${r.value} ${r.unit} (${r.id})`).join('\n')
            : '(no measurements)',
        tableFormatter: () => {
          if (!rows.length) return '(no measurements)'
          const table = new Table({
            head: ['Type', 'Value', 'ID', 'Created'],
            style: { head: [], border: [] },
          })
          for (const r of rows)
            table.push([r.type, `${r.value} ${r.unit}`, r.id, r.date ?? r.created ?? '—'])
          return table.toString()
        },
      })
    })

  measurements
    .command('add <type> <value>')
    .description('Log a body measurement (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (rawType: string, rawValue: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')
      const type = parseType(rawType)
      const value = parseValue(rawValue)
      const service = await createMeasuredValueWriteService()
      logVerbose(ctx, 'Logging body measurement...')
      try {
        const result = await service.logMeasurement(type, value)
        output(
          ctx,
          { ...result, action: 'add' },
          { formatter: (r) => `logged ${r.type}: ${r.value} (${r.id})` },
        )
      } catch (err) {
        wrapWriteError(err)
      }
    })

  measurements
    .command('delete <id>')
    .description('Soft-delete a body measurement (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (id: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental inferred write — server confirmation will be checked.')
      const service = await createMeasuredValueWriteService()
      logVerbose(ctx, `Deleting measurement ${id}...`)
      try {
        const result = await service.deleteMeasurement(id)
        output(
          ctx,
          { ...result, action: 'delete' },
          {
            formatter: (r) =>
              `deleted measurement ${r.id} (serverConfirmed: ${r.serverConfirmed ?? 'undefined'})`,
          },
        )
      } catch (err) {
        wrapWriteError(err)
      }
    })
}
