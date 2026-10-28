/**
 * `strong update` and `strong version` — release standard metadata commands.
 */

import type { Command } from 'commander'
import type { CliContext } from '../cli/context.js'
import { output } from '../cli/output.js'
import { runUpdate, versionDetails } from '../cli-meta.js'

/** `key: value` lines, skipping fields the build could not report. */
export function formatVersionDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n')
}

export function registerMetaCommands(program: Command, ctx: CliContext): void {
  program
    .command('update')
    .description('Update strong the way it was installed')
    .option('--check', 'Report only: exit 0 up to date, 1 update available, 2 unknown')
    .option('--force', 'Update even when already up to date')
    .addHelpText(
      'after',
      `
Updates the way strong was installed: a source checkout pulls, installs and
rebuilds; a global npm install reinstalls @crcatala/strong-cli@latest.

Examples:
  strong update --check    # is a newer commit or release available?
  strong update            # update the way strong was installed
  strong update --force    # reinstall/build even when already current`,
    )
    .action((options: { check?: boolean; force?: boolean }) => {
      process.exitCode = runUpdate('strong', options)
    })

  program
    .command('version')
    .description('Show the version, commit, install method and install path')
    .addHelpText(
      'after',
      `
Examples:
  strong version           # version, commit, date, dirty state, install, path
  strong version --json    # the same as one JSON object`,
    )
    .action(() => {
      const details = versionDetails()
      output(ctx, details, { formatter: formatVersionDetails })
    })
}
