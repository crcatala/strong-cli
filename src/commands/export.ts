/**
 * `strong export` — full JSON export of workouts + exercise definitions.
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { logVerbose, output } from '../cli/output.js'
import { loadWorkoutData } from '../lib/data.js'

export function registerExportCommand(program: Command, ctx: CliContext): void {
  program
    .command('export')
    .description('Export all workout data as JSON (to stdout or a file)')
    .option('-o, --out <file>', 'Write to file instead of stdout')
    .option('--fresh', 'Ignore the local cache and re-sync the full history')
    .addHelpText(
      'after',
      `
Workout logs are cached locally and synced incrementally; pass --fresh to
re-sync the full history before exporting.

Examples:
  strong export --out strong-export.json   # write to file
  strong export --json | jq .totals        # pipe to jq`,
    )
    .action(async (options: { out?: string; fresh?: boolean }) => {
      const client = createClient()
      logVerbose(ctx, options.fresh ? 'Re-syncing full history...' : 'Fetching data...')
      const data = await loadWorkoutData(client, { fresh: options.fresh })

      const exportDoc = {
        exportedAt: new Date().toISOString(),
        username: data.username,
        userId: data.userId,
        weightUnit: data.weightUnit,
        distanceUnit: data.distanceUnit,
        totals: {
          workouts: data.workouts.length,
          exercises: data.globalMeasurements.length + data.userMeasurements.length,
        },
        workouts: data.workouts,
        exercises: data.globalMeasurements,
        customExercises: data.userMeasurements,
      }

      if (options.out) {
        writeFileSync(options.out, `${JSON.stringify(exportDoc, null, 2)}\n`)
        output(
          ctx,
          { ok: true, file: options.out, workouts: data.workouts.length },
          {
            formatter: () => `✓ Exported ${data.workouts.length} workouts to ${options.out}`,
          },
        )
      } else {
        output(ctx, exportDoc)
      }
    })
}
