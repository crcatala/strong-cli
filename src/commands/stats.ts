/**
 * `strong stats` — aggregate statistics across workouts.
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { UsageError } from '../cli/errors.js'
import { logInfo, logVerbose, output } from '../cli/output.js'
import { loadWorkoutData, resolveTaggedMeasurementIds } from '../lib/data.js'
import { parseUnitOverride, resolveWeightUnit, weightLabel } from '../lib/units.js'
import { formatVolume, setVolume, workoutHasAnyTaggedExercise } from '../transform/workouts.js'

interface WeeklyRow {
  week: string
  workouts: number
  sets: number
  volume: number
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function registerStatsCommand(program: Command, ctx: CliContext): void {
  program
    .command('stats')
    .description('Show aggregate workout statistics')
    .option('--weeks <n>', 'Only consider the last N weeks', '0')
    .option('-t, --tag <name>', 'Only workouts containing exercises with this tag')
    .option('--unit <unit>', 'Override display weight unit (kg, lb)')
    .option('--fresh', 'Ignore the local cache and re-sync the full history')
    .addHelpText(
      'after',
      `
Workout logs are cached locally and synced incrementally; pass --fresh to
re-sync the full history.

Examples:
  strong stats                       # all-time totals + weekly breakdown
  strong stats --weeks 12            # last 12 weeks
  strong stats --tag push            # only push-tagged workouts
  strong stats --unit lb             # force lb display regardless of prefs
  strong stats --json                # machine-readable`,
    )
    .action(async (options: { weeks: string; tag?: string; unit?: string; fresh?: boolean }) => {
      const weeks = Number.parseInt(options.weeks, 10)
      if (!Number.isFinite(weeks) || weeks < 0) {
        throw new UsageError(`Invalid --weeks: ${options.weeks}`)
      }

      const client = createClient()
      logVerbose(ctx, options.fresh ? 'Re-syncing full history...' : 'Fetching workouts...')
      const data = await loadWorkoutData(client, { fresh: options.fresh })
      if (data.cache.fullResync === 'interval') {
        logInfo(ctx, 'Full re-sync triggered by the sync interval — pruning deleted workouts')
      }
      const weightUnit =
        parseUnitOverride(options.unit)?.weight ?? resolveWeightUnit(data.weightUnit)
      const weightUnitLabel = weightLabel(weightUnit)

      let workouts = [...data.workouts]
      if (options.tag) {
        logVerbose(ctx, `Filtering by tag: ${options.tag}`)
        const taggedIds = resolveTaggedMeasurementIds(data.tags, options.tag)
        workouts = workouts.filter((w) => workoutHasAnyTaggedExercise(w, taggedIds))
      }
      if (weeks > 0) {
        const cutoff = Date.now() - weeks * 7 * 86400000
        workouts = workouts.filter((w) => {
          const t = w.startDate ? new Date(w.startDate).getTime() : 0
          return t >= cutoff
        })
      }

      const totals = {
        workouts: workouts.length,
        sets: 0,
        volume: 0,
      }
      const weekly = new Map<string, WeeklyRow>()
      const exerciseVolume = new Map<string, number>()
      const exerciseSets = new Map<string, number>()

      for (const w of workouts) {
        const wk = w.startDate ? isoWeek(new Date(w.startDate)) : 'unknown'
        const row = weekly.get(wk) ?? { week: wk, workouts: 0, sets: 0, volume: 0 }
        row.workouts++
        for (const ex of w.exercises) {
          for (const set of ex.sets) {
            row.sets++
            totals.sets++
            const v = setVolume(set)
            row.volume += v
            totals.volume += v
            exerciseVolume.set(ex.name, (exerciseVolume.get(ex.name) ?? 0) + v)
            exerciseSets.set(ex.name, (exerciseSets.get(ex.name) ?? 0) + 1)
          }
        }
        weekly.set(wk, row)
      }

      const weeklySorted = [...weekly.values()].sort((a, b) => a.week.localeCompare(b.week))
      const topExercises = [...exerciseVolume.entries()]
        .map(([name, volume]) => ({ name, volume, sets: exerciseSets.get(name) ?? 0 }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 10)

      output(
        ctx,
        {
          totals,
          weightUnit,
          weekly: weeklySorted,
          topExercises,
        },
        {
          formatter: () => {
            const lines: string[] = []
            lines.push(`Workouts: ${totals.workouts}`)
            lines.push(`Sets:     ${totals.sets}`)
            lines.push(
              `Volume:   ${formatVolume(totals.volume, weightUnit)} ${weightUnitLabel}`.trimEnd(),
            )
            lines.push('')
            lines.push('Weekly volume:')
            if (weeklySorted.length === 0) lines.push('  (no workouts)')
            for (const row of weeklySorted) {
              lines.push(
                `  ${row.week}  ${row.workouts} workouts · ${row.sets} sets · ${formatVolume(row.volume, weightUnit)}`,
              )
            }
            if (topExercises.length > 0) {
              lines.push('')
              lines.push('Top exercises by volume:')
              for (const ex of topExercises) {
                lines.push(
                  `  ${ex.name.padEnd(34)} ${ex.sets} sets · ${formatVolume(ex.volume, weightUnit)}`,
                )
              }
            }
            return lines.join('\n')
          },
          tableFormatter: () => {
            const table = new Table({
              head: ['Week', 'Workouts', 'Sets', `Volume (${weightUnitLabel})`.trim()],
              style: { head: [], border: [] },
            })
            for (const row of weeklySorted) {
              table.push([row.week, row.workouts, row.sets, formatVolume(row.volume, weightUnit)])
            }
            return table.toString()
          },
        },
      )
    })
}
