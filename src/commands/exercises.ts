/**
 * `strong exercises` — browse the exercise (measurement) library and manage
 * your CUSTOM exercise definitions.
 *
 * The global exercise library is a public endpoint; `--user` also loads the
 * user's custom measurements. This command works without authentication for
 * the global library.
 *
 * `create` / `rename` / `archive` operate on the user's CUSTOM definitions
 * (measurement entities in the user doc) — NOT the public library. Writes are
 * opt-in: every write subcommand requires the explicit `--write` flag, which
 * acknowledges the ToS/risk warning (see the write subcommand help).
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { Measurement } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, logWarning, output } from '../cli/output.js'
import { measurementName } from '../transform/workouts.js'
import { makeClock } from '../write/ids.js'
import { saveSnapshot } from '../write/snapshot-store.js'
import { SyncEngine } from '../write/sync-engine.js'
import { WriteEngine } from '../write/write-engine.js'
import { EntityNotFoundError, ExerciseWriteService } from '../write/write-service.js'

/**
 * Cell types the Strong backend accepts in CUSTOM exercise definitions.
 * Probed live on a disposable account (sc-ri38): the broader app CellType
 * union (src/api/types.ts) also contains PLATE_WEIGHT, REST_TIMER and NOTE,
 * but the server rejects all three in custom definitions with HTTP 400
 * CELL_TYPE_CONFIGS_NOT_SUPPORTED (PLATE_WEIGHT additionally fails entity
 * parsing with INVALID_DATA and appears in no public-library exercise).
 * ASSISTED_BODYWEIGHT is accepted and was missing from the old allowlist.
 */
const EXERCISE_CELL_TYPES = new Set([
  'REPS',
  'RPE',
  'OTHER_WEIGHT',
  'BARBELL_WEIGHT',
  'DUMBBELL_WEIGHT',
  'WEIGHTED_BODYWEIGHT',
  'ASSISTED_BODYWEIGHT',
  'DISTANCE',
  'DURATION',
])

/**
 * Ordered cell-type signatures the server accepts for custom exercise
 * definitions. Order is significant: the server matches the exact sequence
 * (REPS,RPE is accepted, RPE,REPS is rejected with
 * CELL_TYPE_CONFIGS_NOT_SUPPORTED). Derived from the 8 signatures present in
 * the public exercise library (253 exercises) plus single REPS, all
 * confirmed by live create+archive probes on a disposable account.
 */
const EXERCISE_CELL_TYPE_SIGNATURES = new Set([
  'REPS',
  'REPS,RPE',
  'DURATION',
  'DISTANCE,DURATION',
  'OTHER_WEIGHT,REPS,RPE',
  'BARBELL_WEIGHT,REPS,RPE',
  'DUMBBELL_WEIGHT,REPS,RPE',
  'WEIGHTED_BODYWEIGHT,REPS,RPE',
  'ASSISTED_BODYWEIGHT,REPS,RPE',
])

/**
 * ToS/risk warning shown in write subcommand help (epic posture): writes are
 * experimental, undocumented, and can risk account termination; live testing
 * must only ever touch a disposable account.
 */
const WRITE_WARNING = `
WARNING: this is an experimental write against an undocumented,
community-reverse-engineered API. Writing to Strong can risk account
termination (ToS gray zone). Only use writes on a DISPOSABLE test account —
never your main account. This subcommand requires the explicit --write flag
to acknowledge this risk.

Custom exercises are YOUR definitions (user doc measurement collection), not
the public library browsed by 'strong exercises'. They are resolvable by id
from the write snapshot and usable when creating templates/workouts.
`

function parseCellTypes(raw: string): string[] {
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) {
    throw new UsageError('--cell-type must list at least one cell type (e.g. REPS,RPE)')
  }
  const seen = new Set<string>()
  for (const t of tokens) {
    if (seen.has(t)) throw new UsageError(`Duplicate cell type "${t}" in --cell-type`)
    if (!EXERCISE_CELL_TYPES.has(t)) {
      throw new UsageError(
        `Unsupported cell type "${t}" — custom exercise definitions support: ${[...EXERCISE_CELL_TYPES].join(', ')}`,
      )
    }
    seen.add(t)
  }
  const signature = tokens.join(',')
  if (!EXERCISE_CELL_TYPE_SIGNATURES.has(signature)) {
    throw new UsageError(
      `Unsupported cell-type combination "${signature}" — the server only accepts these ` +
        `ordered combinations: ${[...EXERCISE_CELL_TYPE_SIGNATURES].join(', ')}. Order matters.`,
    )
  }
  return tokens
}

/** Parse --mandatory/--exponent refs, which must be subsets of --cell-type. */
function parseCellRefs(raw: string | undefined, label: string, allowed: string[]): string[] {
  if (!raw) return []
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0)
  for (const t of tokens) {
    if (!allowed.includes(t)) {
      throw new UsageError(`--${label} cell type "${t}" is not listed in --cell-type`)
    }
  }
  return tokens
}

function collectTag(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/** Opt-in gate: every write subcommand requires `--write`. */
function requireWriteOptIn(write: boolean | undefined): void {
  if (!write) {
    throw new UsageError(
      'writes are opt-in: add --write to acknowledge the ToS/risk warning ' +
        '(see `strong exercises create --help`)',
    )
  }
}

/** Wire the serialized write engine + exercise service to the live account. */
async function createExerciseWriteService() {
  const client = createClient()
  const session = await client.tokenManager.load()
  if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
  const sync = new SyncEngine({ client, userId: session.userId })
  const engine = new WriteEngine({
    refresh: () => sync.sync(),
    put: (envelope) => client.putEnvelope(session.userId, envelope),
    persist: (snapshot) => saveSnapshot(snapshot),
  })
  const service = new ExerciseWriteService({
    engine,
    clock: makeClock(),
    userId: session.userId,
  })
  return service
}

function wrapNotFound(err: unknown): never {
  if (err instanceof EntityNotFoundError) {
    throw new UsageError(
      `Unknown custom exercise id "${err.id}" — not found in your account (create it first ` +
        'with `strong exercises create`, or it may already be archived)',
    )
  }
  throw err
}

export function registerExercisesCommand(program: Command, ctx: CliContext): void {
  const exercises = program
    .command('exercises')
    .description('List exercise definitions')
    .option('-s, --search <query>', 'Filter by name (case-insensitive substring)')
    .option('--user', 'Also include your custom exercises (requires auth)')
    .option('-l, --limit <n>', 'Maximum number of results', '200')
    .addHelpText(
      'after',
      `
The global exercise library is public and requires no auth. Custom exercise
definitions (yours) are listed with --user and are managed by the write
subcommands below (create / rename / archive — each opt-in via --write).

Examples:
  strong exercises                          # first 200 global exercises
  strong exercises --search squat           # find squats
  strong exercises --user                   # global + your custom exercises
  strong exercises --json                   # machine-readable`,
    )
    .action(async (options: { search?: string; user?: boolean; limit: string }) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new UsageError(`Invalid --limit: ${options.limit}`)
      }

      const client = createClient()
      logVerbose(ctx, 'Fetching exercise definitions...')
      const global = await client.getAllMeasurements()
      let measurements: Measurement[] = global._embedded?.measurement ?? []

      if (options.user) {
        const session = await client.tokenManager.load()
        if (!session)
          throw new UsageError('--user requires authentication — run `strong auth login` first')
        const userResp = await client.getUser(session.userId, { includes: ['measurement'] })
        // The user doc includes soft-deleted definitions; archived custom exercises
        // must not reappear in the browse output.
        measurements = [
          ...measurements,
          ...(userResp._embedded?.measurement ?? []).filter((m) => m.isHidden !== true),
        ]
      }

      if (options.search) {
        const q = options.search.toLowerCase()
        measurements = measurements.filter((m) => measurementName(m).toLowerCase().includes(q))
      }

      const rows = measurements.slice(0, limit).map((m) => ({
        id: m.id,
        name: measurementName(m),
        cells: (m.cellTypeConfigs ?? []).map((c) => c.cellType).join(', '),
        // Strong omits false defaults from user-doc measurements, so only an
        // explicit true denotes a public/global definition.
        global: m.isGlobal === true,
        type: m.measurementType ?? 'EXERCISE',
      }))

      output(ctx, rows, {
        formatter: () => {
          if (rows.length === 0) return '(no exercises match)'
          return rows.map((r) => `${r.name}${r.global ? '' : ' (custom)'}`).join('\n')
        },
        tableFormatter: () => {
          if (rows.length === 0) return '(no exercises match)'
          const table = new Table({
            head: ['Name', 'Cells', 'Source'],
            style: { head: [], border: [] },
          })
          for (const r of rows) {
            table.push([r.name, r.cells, r.global ? 'global' : 'custom'])
          }
          return table.toString()
        },
      })
    })

  exercises
    .command('create <name>')
    .description('Create a custom exercise definition (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .requiredOption(
      '--cell-type <types>',
      'Ordered cell types, e.g. REPS,RPE — server-supported combos only',
    )
    .option('--mandatory <types>', 'Comma-separated subset of --cell-type that is mandatory')
    .option('--exponent <types>', 'Comma-separated subset of --cell-type that is exponent (RPE)')
    .option('--notes <text>', 'Instructions/notes for the exercise')
    .option('--tag <id>', 'Attach a tag by id (repeatable)', collectTag, [] as string[])
    .addHelpText('after', WRITE_WARNING)
    .addHelpText(
      'after',
      `
Supported --cell-type combinations (order matters — the server rejects any
other combination with HTTP 400 CELL_TYPE_CONFIGS_NOT_SUPPORTED):
  ${[...EXERCISE_CELL_TYPE_SIGNATURES].join('\n  ')}

--mandatory/--exponent must be subsets of --cell-type.`,
    )
    .action(
      async (
        name: string,
        options: {
          write?: boolean
          cellType: string
          mandatory?: string
          exponent?: string
          notes?: string
          tag: string[]
        },
      ) => {
        requireWriteOptIn(options.write)
        logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

        const cellTypes = parseCellTypes(options.cellType)
        const mandatory = new Set(parseCellRefs(options.mandatory, 'mandatory', cellTypes))
        const exponent = new Set(parseCellRefs(options.exponent, 'exponent', cellTypes))
        const cellTypeConfigs = cellTypes.map((cellType) => ({
          cellType,
          mandatory: mandatory.has(cellType),
          isExponent: exponent.has(cellType),
        }))

        const service = await createExerciseWriteService()
        logVerbose(ctx, 'Creating custom exercise...')
        try {
          const res = await service.createExercise({
            name,
            cellTypeConfigs,
            notes: options.notes,
            tagIds: options.tag.length > 0 ? options.tag : undefined,
          })
          output(
            ctx,
            { id: res.id, name: res.name, action: 'create' },
            {
              formatter: (s) => `created exercise "${s.name}" (${s.id})`,
            },
          )
        } catch (err) {
          wrapNotFound(err)
        }
      },
    )

  exercises
    .command('rename <id> <name>')
    .description('Rename a custom exercise definition (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (id: string, name: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

      const service = await createExerciseWriteService()
      logVerbose(ctx, `Renaming custom exercise ${id}...`)
      try {
        const res = await service.updateExerciseName(id, name)
        output(
          ctx,
          { id: res.id, name, action: 'rename' },
          { formatter: (s) => `renamed exercise ${s.id} -> "${s.name}"` },
        )
      } catch (err) {
        wrapNotFound(err)
      }
    })

  exercises
    .command('archive <id>')
    .description('Archive (soft-delete) a custom exercise definition (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (id: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

      const service = await createExerciseWriteService()
      logVerbose(ctx, `Archiving custom exercise ${id}...`)
      try {
        const res = await service.archiveExercise(id)
        output(
          ctx,
          { id: res.id, action: 'archive' },
          { formatter: (s) => `archived exercise ${s.id}` },
        )
      } catch (err) {
        wrapNotFound(err)
      }
    })
}
