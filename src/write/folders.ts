/**
 * Template folder bookkeeping for the write layer.
 *
 * Ported from jerhinesmith/strong-mcp (MIT) — src/write/folders.ts. Folders
 * organize templates via `_links.template` hrefs on the folder entity; a
 * template is created into a folder (default: the "My Templates" folder) and
 * unlinked from it on delete. All deletes are soft (isHidden), so "unlink"
 * means removing the href, not deleting the folder.
 */

import type { Clock } from './ids.js'
import type { Entity, Snapshot } from './types.js'

export const templateHref = (userId: string, templateId: string): string =>
  `/api/users/${userId}/templates/${templateId}`

function visibleFolders(snapshot: Snapshot): Entity[] {
  return Object.values(snapshot.entities.folder).filter((f) => f.isHidden !== true)
}

/** The default folder for new templates: "My Templates", else the first folder. */
export function defaultFolder(snapshot: Snapshot): Entity | undefined {
  const folders = visibleFolders(snapshot)
  return folders.find((f) => f.id.endsWith('-my-templates')) ?? folders[0]
}

function links(folder: Entity): { href: string }[] {
  const l = (folder._links as { template?: unknown } | undefined)?.template
  return Array.isArray(l) ? (l as { href: string }[]) : []
}

/** Add a template href to a folder's `_links.template` (idempotent). */
export function addTemplateToFolder(
  folder: Entity,
  userId: string,
  templateId: string,
  clock: Clock,
): Entity {
  const clone = structuredClone(folder) as Record<string, unknown>
  const href = templateHref(userId, templateId)
  const current = links(clone as Entity)
  if (!current.some((l) => l.href === href)) current.push({ href })
  const linksObj = (clone._links ?? {}) as Record<string, unknown>
  clone._links = { ...linksObj, template: current }
  clone.lastChanged = clock()
  return clone as Entity
}

/** Remove a template href from a folder's `_links.template`. */
export function removeTemplateFromFolder(
  folder: Entity,
  userId: string,
  templateId: string,
  clock: Clock,
): Entity {
  const clone = structuredClone(folder) as Record<string, unknown>
  const href = templateHref(userId, templateId)
  const linksObj = (clone._links ?? {}) as Record<string, unknown>
  clone._links = {
    ...linksObj,
    template: links(clone as Entity).filter((l) => l.href !== href),
  }
  clone.lastChanged = clock()
  return clone as Entity
}

/** Find the folder whose `_links.template` contains the template href. */
export function findFolderContaining(
  snapshot: Snapshot,
  userId: string,
  templateId: string,
): Entity | undefined {
  const href = templateHref(userId, templateId)
  // Scan ALL folders, including hidden ones: a soft-deleted folder may still
  // hold template links that deleteTemplate must clean up (stated contract).
  return Object.values(snapshot.entities.folder).find((f) => links(f).some((l) => l.href === href))
}
