/**
 * `strong templates` — list routine templates (requires auth).
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import { templateName } from '../transform/workouts.js'

export function registerTemplatesCommand(program: Command, ctx: CliContext): void {
  program
    .command('templates')
    .description('List routine templates')
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
  strong templates --json            # machine-readable`,
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
}
