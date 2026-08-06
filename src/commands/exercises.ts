/**
 * `strong exercises` — browse the exercise (measurement) library.
 *
 * The global exercise library is a public endpoint; `--user` also loads the
 * user's custom measurements. This command works without authentication for
 * the global library.
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { Measurement } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import { measurementName } from '../transform/workouts.js'

export function registerExercisesCommand(program: Command, ctx: CliContext): void {
  program
    .command('exercises')
    .description('List exercise definitions')
    .option('-s, --search <query>', 'Filter by name (case-insensitive substring)')
    .option('--user', 'Also include your custom exercises (requires auth)')
    .option('-l, --limit <n>', 'Maximum number of results', '200')
    .addHelpText(
      'after',
      `
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
        measurements = [...measurements, ...(userResp._embedded?.measurement ?? [])]
      }

      if (options.search) {
        const q = options.search.toLowerCase()
        measurements = measurements.filter((m) => measurementName(m).toLowerCase().includes(q))
      }

      const rows = measurements.slice(0, limit).map((m) => ({
        id: m.id,
        name: measurementName(m),
        cells: (m.cellTypeConfigs ?? []).map((c) => c.cellType).join(', '),
        global: m.isGlobal !== false,
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
}
