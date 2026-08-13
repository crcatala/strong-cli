import { describe, expect, it } from 'vitest'
import {
  addTemplateToFolder,
  defaultFolder,
  findFolderContaining,
  removeTemplateFromFolder,
  templateHref,
} from '../../../src/write/folders.js'
import { makeClock } from '../../../src/write/ids.js'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import type { Snapshot } from '../../../src/write/types.js'
import { asEntityView } from '../../helpers/fixtures.js'

const clock = makeClock(() => 1_700_000_000_000)

function snapshot(folders: Record<string, unknown> = {}): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(folders)) {
    s.entities.folder[id] = entity as never
  }
  return s
}

const myTemplates = {
  id: 'folder-my-templates',
  name: { custom: 'My Templates' },
  isHidden: false,
  _links: { template: [] },
}
const other = {
  id: 'folder-other',
  name: { custom: 'Other' },
  isHidden: false,
  _links: { template: [] },
}

describe('templateHref', () => {
  it('builds the user-scoped template href', () => {
    expect(templateHref('user-1', 'tpl-1')).toBe('/api/users/user-1/templates/tpl-1')
  })
})

describe('defaultFolder', () => {
  it('prefers the "My Templates" folder', () => {
    const s = snapshot({ 'folder-other': other, 'folder-my-templates': myTemplates })
    expect(defaultFolder(s)?.id).toBe('folder-my-templates')
  })

  it('falls back to the first visible folder', () => {
    const s = snapshot({ 'folder-other': other })
    expect(defaultFolder(s)?.id).toBe('folder-other')
  })

  it('skips hidden folders and returns undefined when none are visible', () => {
    const s = snapshot({ 'folder-other': { ...other, isHidden: true } })
    expect(defaultFolder(s)).toBeUndefined()
  })
})

describe('addTemplateToFolder', () => {
  it('appends the template href and bumps lastChanged', () => {
    const updated = addTemplateToFolder(myTemplates, 'user-1', 'tpl-1', clock)
    expect(asEntityView(updated)._links.template).toEqual([
      { href: '/api/users/user-1/templates/tpl-1' },
    ])
    expect(updated.lastChanged).toBe(clock())
    // Original is not mutated.
    expect(myTemplates._links.template).toEqual([])
  })

  it('is idempotent — does not duplicate an existing href', () => {
    const withLink = addTemplateToFolder(myTemplates, 'user-1', 'tpl-1', clock)
    const again = addTemplateToFolder(withLink, 'user-1', 'tpl-1', clock)
    expect(asEntityView(again)._links.template).toEqual([
      { href: '/api/users/user-1/templates/tpl-1' },
    ])
  })
})

describe('removeTemplateFromFolder', () => {
  it('removes the template href and keeps other links', () => {
    const withTwo = addTemplateToFolder(myTemplates, 'user-1', 'tpl-1', clock)
    const withTwo2 = addTemplateToFolder(withTwo, 'user-1', 'tpl-2', clock)
    const updated = removeTemplateFromFolder(withTwo2, 'user-1', 'tpl-1', clock)
    expect(asEntityView(updated)._links.template).toEqual([
      { href: '/api/users/user-1/templates/tpl-2' },
    ])
  })
})

describe('findFolderContaining', () => {
  it('finds the folder whose _links.template contains the href', () => {
    const withLink = addTemplateToFolder(myTemplates, 'user-1', 'tpl-1', clock)
    const s = snapshot({ 'folder-my-templates': withLink, 'folder-other': other })
    expect(findFolderContaining(s, 'user-1', 'tpl-1')?.id).toBe('folder-my-templates')
  })

  it('returns undefined when no folder contains the template', () => {
    const s = snapshot({ 'folder-other': other })
    expect(findFolderContaining(s, 'user-1', 'tpl-1')).toBeUndefined()
  })

  it('finds hidden folders too — delete must unlink from soft-deleted folders', () => {
    const hiddenWithLink = addTemplateToFolder(
      { ...myTemplates, isHidden: true },
      'user-1',
      'tpl-1',
      clock,
    )
    const s = snapshot({ 'folder-my-templates': hiddenWithLink, 'folder-other': other })
    expect(findFolderContaining(s, 'user-1', 'tpl-1')?.id).toBe('folder-my-templates')
  })
})
