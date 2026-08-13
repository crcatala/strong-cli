/**
 * `strong workout [id]` — detailed view of a single workout, plus the opt-in
 * write subcommands `log` / `delete` / `edit` (sc-iwa3).
 *
 * Reads require auth. Writes are opt-in: every write subcommand requires the
 * explicit `--write` flag, which acknowledges the ToS/risk warning (see the
 * write subcommand help).
 */
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { RawLog, Set as WorkoutSet } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { ApiError, AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, logWarning, output } from '../cli/output.js'
import type { DistanceUnit, WeightUnit } from '../lib/units.js'
import {
  distanceLabel,
  distanceToDisplay,
  fmtNumber,
  parseUnitOverride,
  resolveDistanceUnit,
  resolveWeightUnit,
  weightLabel,
  weightToDisplay,
} from '../lib/units.js'
import {
  buildMeasurementMap,
  formatVolume,
  isWorkoutLog,
  setVolume,
  transformLog,
} from '../transform/workouts.js'
import { makeClock } from '../write/ids.js'
import type { BuildLogInput } from '../write/log-builder.js'
import { saveSnapshot } from '../write/snapshot-store.js'
import { SyncEngine } from '../write/sync-engine.js'
import { WriteEngine } from '../write/write-engine.js'
import { EntityNotFoundError, WorkoutWriteService } from '../write/write-service.js'
import { collectExercise, parseExerciseSpec } from './set-spec.js'

/**
 * ToS/risk warning shown in write subcommand help (epic posture): writes are
 * experimental, undocumented, and can risk account termination; live testing
 * must only ever touch a disposable account.
 */
const WORKOUT_WRITE_WARNING = `
WARNING: this is an experimental write against an undocumented,
community-reverse-engineered API. Writing to Strong can risk account
termination (ToS gray zone). Only use writes on a DISPOSABLE test account —
never your main account. This subcommand requires the explicit --write flag
to acknowledge this risk.

Workouts are YOUR completed workouts (user doc log collection). Exercises are
referenced by id from your account (custom or global) and must exist in your
snapshot — sync or create them first with 'strong exercises create'.
`

/**
 * Edit-specific warning: updateWorkoutSets is one of the two INFERRED write
 * shapes (never captured from app traffic) and always runs a post-write
 * re-sync to verify, reporting serverConfirmed.
 */
const WORKOUT_EDIT_WARNING = `
${WORKOUT_WRITE_WARNING}

Edit is an INFERRED write shape (reverse-engineered, never captured from real
app traffic). The result reports serverConfirmed: true means Strong accepted
the edit; false means Strong did not reflect it — the local snapshot is
automatically re-synced to server truth so the unconfirmed edit cannot leak
into later writes (re-run the edit); undefined means the confirmation re-sync
failed.
`

/** Opt-in gate: every write subcommand requires `--write`. */
function requireWriteOptIn(write: boolean | undefined): void {
  if (!write) {
    throw new UsageError(
      'writes are opt-in: add --write to acknowledge the ToS/risk warning ' +
        '(see `strong workout log --help`)',
    )
  }
}

/** Wire the serialized write engine + workout service to the live account. */
async function createWorkoutWriteService() {
  const client = createClient()
  const session = await client.tokenManager.load()
  if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')
  const sync = new SyncEngine({ client, userId: session.userId })
  const engine = new WriteEngine({
    refresh: () => sync.sync(),
    put: (envelope) => client.putEnvelope(session.userId, envelope),
    persist: (snapshot) => saveSnapshot(snapshot),
  })
  return new WorkoutWriteService({
    engine,
    clock: makeClock(),
    userId: session.userId,
    resync: () => sync.resync(),
    // An unconfirmed edit is reconciled to pristine server truth so the
    // optimistic snapshot cannot replay it into later writes.
    reconcile: (fresh) => saveSnapshot(fresh),
  })
}

/** Parse a `--set <groupIndex>:<setIndex>` target (0-based positions). */
function parseSetTarget(spec: string): { groupIndex: number; setIndex: number } {
  const m = /^(\d+):(\d+)$/.exec(spec.trim())
  if (!m) {
    throw new UsageError(
      `Invalid --set "${spec}" — expected <groupIndex>:<setIndex> (0-based), e.g. 0:1`,
    )
  }
  return { groupIndex: Number.parseInt(m[1], 10), setIndex: Number.parseInt(m[2], 10) }
}

/** Convert write-layer errors into clean UsageErrors with guidance. */
function wrapWriteError(err: unknown): never {
  if (err instanceof EntityNotFoundError) {
    if (err.collection === 'log') {
      throw new UsageError(
        `Unknown workout id "${err.id}" — not found in your account (list ids with \`strong workouts\`; it may already be deleted)`,
      )
    }
    throw new UsageError(`Unknown ${err.collection} id "${err.id}" — not found in your account`)
  }
  if (err instanceof Error && err.message.startsWith('Unknown exercise id')) {
    throw new UsageError(
      `${err.message} — sync or create the exercise first with \`strong exercises create\``,
    )
  }
  if (err instanceof Error && err.message.startsWith('Archived exercise id')) {
    throw new UsageError(err.message)
  }
  if (
    err instanceof Error &&
    /(out of range|has no .* cell to edit|specifies no reps\/weight\/rpe)/.test(err.message)
  ) {
    throw new UsageError(err.message)
  }
  throw err
}

function fmtSet(set: WorkoutSet, weightUnit: WeightUnit, distanceUnit: DistanceUnit): string {
  const parts: string[] = []
  if (set.weight !== null) {
    parts.push(`${fmtNumber(weightToDisplay(set.weight, weightUnit))} ${weightLabel(weightUnit)}`)
  }
  if (set.reps !== null) parts.push(`× ${set.reps}`)
  if (set.distance !== null) {
    parts.push(
      `${fmtNumber(distanceToDisplay(set.distance, distanceUnit))} ${distanceLabel(distanceUnit)}`,
    )
  }
  if (set.duration !== null) parts.push(`dur ${set.duration}`)
  if (set.rpe !== null) parts.push(`@${set.rpe}`)
  return parts.join(' ') || '(empty set)'
}

export function registerWorkoutCommand(program: Command, ctx: CliContext): void {
  const workout = program
    .command('workout [id]')
    .description('Show a single workout in detail (and manage workouts with log/delete/edit)')
    .option('--unit <unit>', 'Override display units (kg, lb, m, km, mi)')
    .addHelpText(
      'after',
      `
Show one workout:
  strong workout 4f7b1c2e-...  # log id from \`strong workouts\`
  strong workout 4f7b1c2e-... --unit lb  # force lb display

Write subcommands (each opt-in via --write):
  strong workout log <name> --exercise <id>:<sets> [--template <id>]
  strong workout delete <id>
  strong workout edit <id> --set <groupIndex>:<setIndex> [--reps N] [--weight W] [--rpe R]`,
    )
    .action(async (id: string | undefined, options: { unit?: string }) => {
      if (!id) throw new UsageError('workout id is required')

      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')

      // Fetch the single log directly instead of paginating the whole history.
      logVerbose(ctx, `Fetching workout ${id}...`)
      let rawLog: RawLog
      try {
        rawLog = await client.getLog(session.userId, id)
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) {
          notFound(ctx, id)
          return
        }
        throw err
      }

      // Preserve the previous behavior: non-workout logs (notes etc.) are not found.
      if (!isWorkoutLog(rawLog)) {
        notFound(ctx, id)
        return
      }

      // Resolve exercise names from global + user exercise definitions.
      logVerbose(ctx, 'Resolving exercise names...')
      const [userResp, globalMeasurements] = await Promise.all([
        client.getUser(session.userId, { includes: ['measurement'] }),
        client.getAllMeasurements(),
      ])
      const measurementMap = buildMeasurementMap(
        globalMeasurements._embedded?.measurement ?? [],
        userResp._embedded?.measurement ?? [],
      )
      const override = parseUnitOverride(options.unit)
      const weightUnit =
        override?.weight ?? resolveWeightUnit(userResp.preferences?.weightUnit?.[session.userId])
      const distanceUnit =
        override?.distance ??
        resolveDistanceUnit(userResp.preferences?.distanceUnit?.[session.userId])
      const workout = transformLog(rawLog, measurementMap)

      const summary = {
        id: workout.id,
        name: workout.name,
        startDate: workout.startDate,
        endDate: workout.endDate,
        timezoneId: workout.timezoneId,
        // Raw values are canonical metric (kg·reps); units describe the
        // account's display preference.
        weightUnit,
        distanceUnit,
        exercises: workout.exercises.map((ex) => ({
          id: ex.id,
          name: ex.name,
          sets: ex.sets,
          skippedSets: ex.skippedSets,
        })),
        volume: workout.exercises.reduce(
          (sum, ex) => sum + ex.sets.reduce((s, set) => s + setVolume(set), 0),
          0,
        ),
      }

      output(ctx, summary, {
        formatter: () => {
          const lines: string[] = []
          const title = workout.name ?? '(unnamed)'
          const start = workout.startDate ?? '—'
          const end = workout.endDate ?? ''
          lines.push(
            `${title} — ${start} → ${end}${workout.timezoneId ? ` (${workout.timezoneId})` : ''}`,
          )
          const sets = workout.exercises.reduce((n, ex) => n + ex.sets.length, 0)
          lines.push(
            `Total: ${workout.exercises.length} exercises · ${sets} sets · ${formatVolume(summary.volume, weightUnit)} ${weightLabel(weightUnit)}`,
          )
          lines.push('')
          for (const ex of workout.exercises) {
            lines.push(ex.name)
            for (const set of ex.sets) lines.push(`  ${fmtSet(set, weightUnit, distanceUnit)}`)
            if (ex.skippedSets.length > 0) {
              lines.push(
                `  (skipped: ${ex.skippedSets.map((s) => fmtSet(s, weightUnit, distanceUnit)).join('; ')})`,
              )
            }
            if (ex.sets.length === 0 && ex.skippedSets.length === 0) lines.push('  (no sets)')
          }
          return lines.join('\n')
        },
      })
    })

  workout
    .command('log <name>')
    .description('Log a completed workout (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .option(
      '--exercise <spec>',
      'Exercise + sets, e.g. ex-1:10@60,8@70 (repeatable)',
      collectExercise,
      [] as string[],
    )
    .option('--template <id>', 'Link the workout to a routine template by id')
    .addHelpText('after', WORKOUT_WRITE_WARNING)
    .action(
      async (name: string, options: { write?: boolean; exercise: string[]; template?: string }) => {
        requireWriteOptIn(options.write)
        logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

        if (options.exercise.length === 0) {
          throw new UsageError('--exercise is required (e.g. --exercise ex-1:10@60,8@70)')
        }
        const exercises = options.exercise.map(parseExerciseSpec)
        const input: BuildLogInput = { name, exercises }
        if (options.template) input.templateId = options.template

        const service = await createWorkoutWriteService()
        logVerbose(ctx, 'Logging workout...')
        try {
          const res = await service.logWorkout(input)
          output(
            ctx,
            { id: res.id, name: res.name, action: 'log', exercises: res.exercises },
            { formatter: (s) => `logged workout "${s.name}" (${s.id})` },
          )
        } catch (err) {
          wrapWriteError(err)
        }
      },
    )

  workout
    .command('delete <id>')
    .description('Delete (soft-delete) a logged workout (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .addHelpText('after', WORKOUT_WRITE_WARNING)
    .action(async (id: string, options: { write?: boolean }) => {
      requireWriteOptIn(options.write)
      logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

      const service = await createWorkoutWriteService()
      logVerbose(ctx, `Deleting workout ${id}...`)
      try {
        const res = await service.deleteWorkout(id)
        output(
          ctx,
          { id: res.id, action: 'delete' },
          { formatter: (s) => `deleted workout ${s.id}` },
        )
      } catch (err) {
        wrapWriteError(err)
      }
    })

  workout
    .command('edit <id>')
    .description('Edit reps/weight/rpe of a set in a logged workout (opt-in write)')
    .option('--write', 'Acknowledge the ToS/risk warning and enable this write')
    .option('--set <groupIndex>:<setIndex>', 'Which set to edit (0-based group:set position)')
    .option('--reps <n>', 'New reps for the targeted set')
    .option('--weight <w>', 'New weight in display units (converted to kg on the wire)')
    .option('--rpe <r>', 'New RPE for the targeted set')
    .addHelpText('after', WORKOUT_EDIT_WARNING)
    .action(
      async (
        id: string,
        options: {
          write?: boolean
          set?: string
          reps?: string
          weight?: string
          rpe?: string
        },
      ) => {
        requireWriteOptIn(options.write)
        logWarning(ctx, 'Experimental write — see help for the ToS/risk warning.')

        if (!options.set) {
          throw new UsageError('--set is required (e.g. --set 0:1)')
        }
        const target = parseSetTarget(options.set)
        const edit: {
          groupIndex: number
          setIndex: number
          reps?: number
          weight?: number
          rpe?: number
        } = {
          groupIndex: target.groupIndex,
          setIndex: target.setIndex,
        }
        if (options.reps !== undefined) {
          const reps = Number(options.reps)
          if (!Number.isInteger(reps) || reps <= 0) {
            throw new UsageError(`Invalid --reps: ${options.reps} (expected a positive integer)`)
          }
          edit.reps = reps
        }
        if (options.weight !== undefined) {
          const weight = Number(options.weight)
          // Weight 0 is valid: it clears added load on weighted-bodyweight /
          // bodyweight sets (workout logging already permits 0 via set specs).
          if (!Number.isFinite(weight) || weight < 0) {
            throw new UsageError(
              `Invalid --weight: ${options.weight} (expected a non-negative number)`,
            )
          }
          edit.weight = weight
        }
        if (options.rpe !== undefined) {
          const rpe = Number(options.rpe)
          if (!Number.isFinite(rpe) || rpe <= 0) {
            throw new UsageError(`Invalid --rpe: ${options.rpe} (expected a positive number)`)
          }
          edit.rpe = rpe
        }
        if (edit.reps === undefined && edit.weight === undefined && edit.rpe === undefined) {
          throw new UsageError('specify at least one of --reps, --weight, --rpe')
        }

        const service = await createWorkoutWriteService()
        logVerbose(ctx, `Editing workout ${id}...`)
        try {
          const res = await service.updateWorkoutSets(id, [edit])
          output(
            ctx,
            { id: res.id, action: 'edit', serverConfirmed: res.serverConfirmed },
            {
              formatter: (s) => {
                const conf =
                  s.serverConfirmed === undefined
                    ? 'unverified (re-sync failed)'
                    : `serverConfirmed: ${s.serverConfirmed}`
                return `edited workout ${s.id} (${conf})`
              },
            },
          )
        } catch (err) {
          wrapWriteError(err)
        }
      },
    )
}

function notFound(ctx: CliContext, id: string): void {
  output(
    ctx,
    { id, found: false },
    {
      formatter: () => `Workout ${id} not found. Run \`strong workouts\` to list ids.`,
    },
  )
}
