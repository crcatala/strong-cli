/**
 * `strong folders` — list template folders (requires auth).
 */

import Table from 'cli-table3'
import type { Command } from 'commander'
import { createClient } from '../api/factory.js'
import type { CliContext } from '../cli/context.js'
import { AuthError, UsageError } from '../cli/errors.js'
import { logVerbose, output } from '../cli/output.js'
import { folderName } from '../transform/workouts.js'

export function registerFoldersCommand(program: Command, ctx: CliContext): void {
  program
    .command('folders')
    .description('List template folders')
    .option('-s, --search <query>', 'Filter by name (case-insensitive substring)')
    .option('-l, --limit <n>', 'Maximum number of results', '100')
    .addHelpText(
      'after',
      `
Folders require authentication.

Examples:
  strong folders                      # list all folders
  strong folders --search push        # folders whose name contains "push"
  strong folders --table              # table view
  strong folders --json               # machine-readable`,
    )
    .action(async (options: { search?: string; limit: string }) => {
      const limit = Number.parseInt(options.limit, 10)
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new UsageError(`Invalid --limit: ${options.limit}`)
      }

      const client = createClient()
      const session = await client.tokenManager.load()
      if (!session) throw new AuthError('Not authenticated — run `strong auth login` first')

      logVerbose(ctx, 'Fetching folders...')
      let folders = await client.getFolders(session.userId)

      if (options.search) {
        const q = options.search.toLowerCase()
        folders = folders.filter((f) => folderName(f).toLowerCase().includes(q))
      }

      const rows = folders.slice(0, limit).map((f) => ({ id: f.id, name: folderName(f) }))

      output(ctx, rows, {
        formatter: () => {
          if (rows.length === 0) return '(no folders)'
          return rows.map((r) => r.name).join('\n')
        },
        tableFormatter: () => {
          if (rows.length === 0) return '(no folders)'
          const table = new Table({ head: ['Name', 'ID'], style: { head: [], border: [] } })
          for (const r of rows) table.push([r.name, r.id])
          return table.toString()
        },
      })
    })
}
