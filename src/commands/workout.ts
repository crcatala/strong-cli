/**
 * `strong workout <id>` — detailed view of a single workout.
 */
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { RawLog, Set as WorkoutSet } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { ApiError, AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import type { DistanceUnit, WeightUnit } from '../lib/units.js'
import {
  distanceLabel,
  distanceToDisplay,
  fmtNumber,
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
  program
    .command('workout <id>')
    .description('Show a single workout in detail')
    .addHelpText(
      'after',
      '\nExamples:\n  strong workout 4f7b1c2e-...  # log id from `strong workouts`',
    )
    .action(async (id: string) => {
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
      const weightUnit = resolveWeightUnit(userResp.preferences?.weightUnit?.[session.userId])
      const distanceUnit = resolveDistanceUnit(userResp.preferences?.distanceUnit?.[session.userId])
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
