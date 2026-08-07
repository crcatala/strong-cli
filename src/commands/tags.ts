/**
 * `strong tags` — list exercise tags (requires auth).
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import { tagName } from '../transform/workouts.js'

export function registerTagsCommand(program: Command, ctx: CliContext): void {
  program
    .command('tags')
    .description('List exercise tags')
    .option('-s, --search <query>', 'Filter by name (case-insensitive substring)')
    .option('-l, --limit <n>', 'Maximum number of results', '100')
    .addHelpText(
      'after',
      `
Tags require authentication.

Examples:
  strong tags                        # list all tags
  strong tags --search push          # tags whose name contains "push"
  strong tags --table                # table view
  strong tags --json                 # machine-readable`,
    )
    .action(async (options: { search?: string; limit: string }) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new UsageError(`Invalid --limit: ${options.limit}`)
      }

      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')

      logVerbose(ctx, 'Fetching tags...')
      let tags = await client.getTags(session.userId)

      if (options.search) {
        const q = options.search.toLowerCase()
        tags = tags.filter((t) => tagName(t).toLowerCase().includes(q))
      }

      const rows = tags.slice(0, limit).map((t) => ({ id: t.id, name: tagName(t) }))

      output(ctx, rows, {
        formatter: () => {
          if (rows.length === 0) return '(no tags)'
          return rows.map((r) => r.name).join('\n')
        },
        tableFormatter: () => {
          if (rows.length === 0) return '(no tags)'
          const table = new Table({ head: ['Name', 'ID'], style: { head: [], border: [] } })
          for (const r of rows) table.push([r.name, r.id])
          return table.toString()
        },
      })
    })
}
