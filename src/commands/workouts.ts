/**
 * `strong workouts` — list workouts with per-workout summaries.
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { WorkoutSummary } from '../api/types.js'
import type { CliContext } from '../cli/context.js'
import { UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import { loadWorkoutData } from '../lib/data.js'
import { parseUnitOverride, resolveWeightUnit, weightLabel } from '../lib/units.js'
import { formatVolume, toSummary } from '../transform/workouts.js'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(11, 16)
}

function sortByDateDesc(items: WorkoutSummary[]): WorkoutSummary[] {
  return [...items].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
}

export function registerWorkoutsCommand(program: Command, ctx: CliContext): void {
  program
    .command('workouts')
    .description('List workouts')
    .option('-l, --limit <n>', 'Maximum number of workouts to show', '100')
    .option('--since <date>', 'Only workouts on/after this date (YYYY-MM-DD or ISO)')
    .option('--unit <unit>', 'Override display weight unit (kg, lb)')
    .option('--fresh', 'Ignore the local cache and re-sync the full history')
    .addHelpText(
      'after',
      `
Each row includes the workout ID — copy it to view details:
  strong workout <id>

Workout logs are cached locally (~/.config/strong-cli/cache.json) and synced
incrementally; pass --fresh to re-sync the full history.

Examples:
  strong workouts                     # latest 100 workouts
  strong workouts --limit 5 --table   # table view
  strong workouts --since 2026-01-01  # workouts this year
  strong workouts --unit lb           # force lb display regardless of prefs
  strong workouts --json              # full machine-readable output`,
    )
    .action(async (options: { limit: string; since?: string; unit?: string; fresh?: boolean }) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new UsageError(`Invalid --limit: ${options.limit}`)
      }

      const client = createClient()
      logVerbose(ctx, options.fresh ? 'Re-syncing full history...' : 'Fetching workouts...')
      const data = await loadWorkoutData(client, { fresh: options.fresh })

      let summaries = data.workouts.map(toSummary)
      if (options.since) {
        const since = new Date(options.since)
        if (Number.isNaN(since.getTime())) {
          throw new UsageError(`Invalid --since date: ${options.since}`)
        }
        const sinceMs = since.getTime()
        summaries = summaries.filter((w) => {
          const t = w.startDate ? new Date(w.startDate).getTime() : 0
          return t >= sinceMs
        })
      }
      summaries = sortByDateDesc(summaries).slice(0, limit)

      const weightUnit =
        parseUnitOverride(options.unit)?.weight ?? resolveWeightUnit(data.weightUnit)
      const weightUnitLabel = weightLabel(weightUnit)
      output(ctx, summaries, {
        formatter: () => {
          if (summaries.length === 0) return '(no workouts)'
          return summaries
            .map((w) => {
              const date = formatDate(w.date)
              const time = formatTime(w.startDate)
              const name = (w.name ?? '(unnamed)').padEnd(32)
              const volume = formatVolume(w.volume, weightUnit)
              const id = ctx.colors.muted(w.id)
              return `${date} ${time}  ${name}  ${w.exercises} ex · ${w.completedSets} sets · ${volume} ${weightUnitLabel}  ${id}`.trimEnd()
            })
            .join('\n')
        },
        tableFormatter: () => {
          if (summaries.length === 0) return '(no workouts)'
          const table = new Table({
            head: [
              'Date',
              'Time',
              'Name',
              'ID',
              'Ex',
              'Sets',
              `Volume (${weightUnitLabel})`.trim(),
            ],
            style: { head: [], border: [] },
          })
          for (const w of summaries) {
            table.push([
              formatDate(w.date),
              formatTime(w.startDate),
              w.name ?? '(unnamed)',
              w.id,
              w.exercises,
              w.completedSets,
              formatVolume(w.volume, weightUnit),
            ])
          }
          return table.toString()
        },
      })
    })
}
