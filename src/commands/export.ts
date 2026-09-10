/**
 * `strong export` — full JSON export of workouts + exercise definitions.
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { UsageError } from '../cli/errors.js'
import { logInfo, logVerbose, output } from '../cli/output.js'
import { loadWorkoutData, resolveTaggedMeasurementIds } from '../lib/data.js'
import { workoutHasAnyTaggedExercise } from '../transform/workouts.js'

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function parseSince(value: string): number {
  // Date-only values are intentionally UTC midnight, matching the existing
  // `workouts --since` behavior. ISO timestamps must include a timezone so a
  // machine export does not depend on the host's local timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && validCalendarDate(value)) {
    return new Date(`${value}T00:00:00.000Z`).getTime()
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validCalendarDate(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getTime()
  }
  throw new UsageError(`Invalid --since date: ${value}`)
}

export function registerExportCommand(program: Command, ctx: CliContext): void {
  program
    .command('export')
    .description('Export all workout data as JSON (to stdout or a file)')
    .option('-o, --out <file>', 'Write to file instead of stdout')
    .option('-t, --tag <name>', 'Only export workouts containing exercises with this tag')
    .option('--since <date>', 'Only export workouts on/after this date (YYYY-MM-DD or ISO instant)')
    .option('--fresh', 'Ignore the local cache and re-sync the full history')
    .addHelpText(
      'after',
      `
Workout logs are cached locally and synced incrementally; pass --fresh to
re-sync the full history before exporting.

Examples:
  strong export --out strong-export.json   # write to file
  strong export --tag push                 # only push-tagged workouts
  strong export --since 2026-01-01         # enriched workouts this year
  strong export --json | jq .totals        # pipe to jq`,
    )
    .action(async (options: { out?: string; tag?: string; since?: string; fresh?: boolean }) => {
      const sinceMs = options.since ? parseSince(options.since) : undefined
      const client = createClient()
      logVerbose(ctx, options.fresh ? 'Re-syncing full history...' : 'Fetching data...')
      const data = await loadWorkoutData(client, { fresh: options.fresh })
      if (data.cache.fullResync === 'interval') {
        logInfo(ctx, 'Full re-sync triggered by the sync interval — pruning deleted workouts')
      }

      let workouts = data.workouts
      const filter: { tag?: string; since?: string } = {}
      if (sinceMs !== undefined && options.since) {
        workouts = workouts.filter((workout) => {
          const startMs = workout.startDate ? new Date(workout.startDate).getTime() : NaN
          return !Number.isNaN(startMs) && startMs >= sinceMs
        })
        filter.since = options.since
      }
      if (options.tag) {
        logVerbose(ctx, `Filtering by tag: ${options.tag}`)
        const taggedIds = resolveTaggedMeasurementIds(data.tags, options.tag)
        workouts = workouts.filter((w) => workoutHasAnyTaggedExercise(w, taggedIds))
        filter.tag = options.tag
      }

      const exportDoc = {
        exportedAt: new Date().toISOString(),
        username: data.username,
        userId: data.userId,
        weightUnit: data.weightUnit,
        distanceUnit: data.distanceUnit,
        ...(filter.tag || filter.since ? { filter } : {}),
        totals: {
          workouts: workouts.length,
          exercises: data.globalMeasurements.length + data.userMeasurements.length,
        },
        workouts,
        exercises: data.globalMeasurements,
        customExercises: data.userMeasurements,
      }

      if (options.out) {
        writeFileSync(options.out, `${JSON.stringify(exportDoc, null, 2)}\n`)
        output(
          ctx,
          { ok: true, file: options.out, workouts: workouts.length },
          {
            formatter: () => `✓ Exported ${workouts.length} workouts to ${options.out}`,
          },
        )
      } else {
        output(ctx, exportDoc)
      }
    })
}
