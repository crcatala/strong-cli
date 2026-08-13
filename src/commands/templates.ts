/**
 * `strong templates` — list routine templates and manage them with the
 * opt-in write subcommands `create` / `rename` / `delete`.
 *
 * Reads require auth. Writes are opt-in: every write subcommand requires the
 * explicit `--write` flag, which acknowledges the ToS/risk warning (see the
 * write subcommand help).
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, logWarning, output } from '../cli/output.js'
import { templateName } from '../transform/workouts.js'
import { makeClock } from '../write/ids.js'
import type { ExerciseInput, SetInput } from '../write/log-builder.js'
import { saveSnapshot } from '../write/snapshot-store.js'
import { SyncEngine } from '../write/sync-engine.js'
import { WriteEngine } from '../write/write-engine.js'
import {
  type CreateTemplateInput,
  EntityNotFoundError,
  TemplateWriteService,
} from '../write/write-service.js'

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

Templates are YOUR routine templates (user doc template collection). Exercises
are referenced by id from your account (custom or global) and must exist in
your snapshot — sync or create them first with 'strong exercises create'.
`

/** Opt-in gate: every write subcommand requires `--write`. */
function requireWriteOptIn(write: boolean | undefined): void {
  if (!write) {
    throw new UsageError(
      'writes are opt-in: add --write to acknowledge the ToS/risk warning ' +
        '(see `strong templates create --help`)',
    )
  }
}

/** Wire the serialized write engine + template service to the live account. */
async function createTemplateWriteService() {
  const client = createClient()
  const session = await client.tokenManager.load()
  if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
  const sync = new SyncEngine({ client, userId: session.userId })
  const engine = new WriteEngine({
    refresh: () => sync.sync(),
    put: (envelope) => client.putEnvelope(session.userId, envelope),
    persist: (snapshot) => saveSnapshot(snapshot),
  })
  return new TemplateWriteService({
    engine,
    clock: makeClock(),
    userId: session.userId,
  })
}

/**
 * Parse a single set spec `reps[@weight][~rpe]` (weight in display units,
 * converted to kg on the wire). e.g. `10`, `10@60`, `8@60~8`.
 */
function parseSetSpec(spec: string): SetInput {
  const m = /^(\d+)(?:@([\d.]+))?(?:~(\d+))?$/.exec(spec.trim())
  if (!m) {
    throw new UsageError(
      `Invalid set spec "${spec}" — expected reps[@weight][~rpe], e.g. 10@60 or 8@60~8`,
    )
  }
  const reps = Number.parseInt(m[1], 10)
  const weight = m[2] !== undefined ? Number.parseFloat(m[2]) : 0
  const rpe = m[3] !== undefined ? Number.parseInt(m[3], 10) : undefined
  if (!Number.isFinite(reps) || reps <= 0) {
    throw new UsageError(`Invalid reps in set spec "${spec}"`)
  }
  if (!Number.isFinite(weight) || weight < 0) {
    throw new UsageError(`Invalid weight in set spec "${spec}"`)
  }
  if (rpe !== undefined && (!Number.isFinite(rpe) || rpe <= 0)) {
    throw new UsageError(`Invalid RPE in set spec "${spec}"`)
  }
  return { reps, weight, rpe }
}

/** Parse an `--exercise <id>:<sets>` spec, e.g. `ex-1:10@60,8@70`. */
function parseExerciseSpec(spec: string): ExerciseInput {
  const idx = spec.indexOf(':')
  if (idx <= 0) {
    throw new UsageError(
      `Invalid --exercise "${spec}" — expected <exercise-id>:<sets>, e.g. ex-1:10@60,8@70`,
    )
  }
  const exerciseId = spec.slice(0, idx).trim()
  const sets = spec
    .slice(idx + 1)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseSetSpec)
  if (sets.length === 0) {
    throw new UsageError(`--exercise "${spec}" must list at least one set`)
  }
  return { exerciseId, sets }
}

function collectExercise(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/** Convert write-layer errors into clean UsageErrors with guidance. */
function wrapWriteError(err: unknown): never {
  if (err instanceof EntityNotFoundError) {
    if (err.collection === 'folder') {
      throw new UsageError(
        `Unknown folder id "${err.id}" — not found in your account (omit --folder to use the default)`,
      )
    }
    throw new UsageError(
      `Unknown template id "${err.id}" — not found in your account (create it first with ` +
        '`strong templates create`, or it may already be deleted)',
    )
  }
  if (err instanceof Error && err.message.startsWith('Unknown exercise id')) {
    throw new UsageError(
      `${err.message} — sync or create the exercise first with \`strong exercises create\``,
    )
  }
  throw err
}

export function registerTemplatesCommand(program: Command, ctx: CliContext): void {
  const templates = program
    .command('templates')
    .description('List routine templates (and manage them with create/rename/delete)')
    .option('-s, --search <query>', 'Filter by name (case-insensitive substring)')
    .option('-l, --limit <n>', 'Maximum number of results', '100')
    .addHelpText(
      'after',
      `
Templates require authentication.

Examples:
  strong templates                   # first 100 templates
  strong templates --search push     # templates whose name contains "push"
  strong templates --table           # table view
  strong templates --json            # machine-readable

Write subcommands (each opt-in via --write):
  strong templates create <name> --exercise <id>:<sets> [--folder <id>]
  strong templates rename <id> <name>
  strong templates delete <id>`,
    )
    .action(async (options: { search?: string; limit: string }) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new UsageError(`Invalid --limit: ${options.limit}`)
      }

      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')

      logVerbose(ctx, 'Fetching templates...')
      // Pagination: getTemplates walks the user doc (`include=template`) with
      // the same continuation-cursor loop as logs — no truncation for accounts
      // with many templates (fixes the old single-page gap, sc-sfn8).
      let templates = await client.getTemplates(session.userId)

      if (options.search) {
        const q = options.search.toLowerCase()
        templates = templates.filter((t) => templateName(t).toLowerCase().includes(q))
      }

      const rows = templates.slice(0, limit).map((t) => ({ id: t.id, name: templateName(t) }))

      output(ctx, rows, {
        formatter: () => {
          if (rows.length === 0) return '(no templates)'
          return rows.map((r) => r.name).join('\n')
        },
        tableFormatter: () => {
          if (rows.length === 0) return '(no templates)'
          const table = new Table({ head: ['Name', 'ID'], style: { head: [], border: [] } })
          for (const r of rows) table.push([r.name, r.id])
          return table.toString()
        },
      })
    })

  templates
    .command('create <name>')
    .description('Create a routine template (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .option(
      '--exercise <spec>',
      'Exercise + sets, e.g. ex-1:10@60,8@70 (repeatable)',
      collectExercise,
      [] as string[],
    )
    .option('--folder <id>', 'Folder to create the template in (default: My Templates)')
    .addHelpText('after', WRITE_WARNING)
    .action(
      async (name: string, options: { write?: boolean; exercise: string[]; folder?: string }) => {
        requireWriteOptIn(options.write)
        logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

        if (options.exercise.length === 0) {
          throw new UsageError('--exercise is required (e.g. --exercise ex-1:10@60,8@70)')
        }
        const exercises = options.exercise.map(parseExerciseSpec)
        const input: CreateTemplateInput = { name, exercises }
        if (options.folder) input.folderId = options.folder

        const service = await createTemplateWriteService()
        logVerbose(ctx, 'Creating template...')
        try {
          const res = await service.createTemplate(input)
          output(
            ctx,
            { id: res.id, name: res.name, action: 'create' },
            { formatter: (s) => `created template "${s.name}" (${s.id})` },
          )
        } catch (err) {
          wrapWriteError(err)
        }
      },
    )

  templates
    .command('rename <id> <name>')
    .description('Rename a routine template (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (id: string, name: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

      const service = await createTemplateWriteService()
      logVerbose(ctx, `Renaming template ${id}...`)
      try {
        const res = await service.updateTemplateName(id, name)
        output(
          ctx,
          { id: res.id, name, action: 'rename' },
          { formatter: (s) => `renamed template ${s.id} -> "${s.name}"` },
        )
      } catch (err) {
        wrapWriteError(err)
      }
    })

  templates
    .command('delete <id>')
    .description(
      'Delete (soft-delete) a routine template and unlink it from its folder (opt-in write)',
    )
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WRITE_WARNING)
    .action(async (id: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

      const service = await createTemplateWriteService()
      logVerbose(ctx, `Deleting template ${id}...`)
      try {
        const res = await service.deleteTemplate(id)
        output(
          ctx,
          { id: res.id, action: 'delete' },
          { formatter: (s) => `deleted template ${s.id}` },
        )
      } catch (err) {
        wrapWriteError(err)
      }
    })
}
