import { describe, expect, it, vi } from 'vitest'
import { makeClock } from '../../../src/write/ids.js'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import type { Snapshot } from '../../../src/write/types.js'
import { type WriteDeps, WriteEngine } from '../../../src/write/write-engine.js'
import {
  EntityNotFoundError,
  ExerciseWriteService,
  TemplateWriteService,
} from '../../../src/write/write-service.js'

const clock = makeClock(() => 1_700_000_000_000)

function snapshot(measurements: Record<string, unknown> = {}): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(measurements)) {
    s.entities.measurement[id] = entity as never
  }
  return s
}

function deps(measurements: Record<string, unknown> = {}): WriteDeps & {
  put: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(async () => snapshot(measurements))
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist }
}

function service(d: WriteDeps): ExerciseWriteService {
  return new ExerciseWriteService({ engine: new WriteEngine(d), clock, userId: 'user-1' })
}

describe('ExerciseWriteService', () => {
  it('createExercise PUTs a built measurement entity and returns id + name', async () => {
    const d = deps()
    const res = await service(d).createExercise({
      name: 'Hack Squat',
      cellTypeConfigs: [{ cellType: 'REPS', mandatory: true }],
      notes: 'deep',
      tagIds: ['tag-1'],
    })

    expect(res.name).toBe('Hack Squat')
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)

    const envelope = d.put.mock.calls[0][0]
    expect(envelope.id).toBe('user-1')
    expect(envelope._embedded.measurement).toHaveLength(1)
    const sent = envelope._embedded.measurement[0]
    expect(sent.id).toBe(res.id)
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
    expect(sent.measurementType).toBe('EXERCISE')
    expect(sent.isHidden).toBe(false)
    // All unchanged collections are sent as empty arrays.
    expect(envelope._embedded.template).toEqual([])
    expect(envelope._embedded.log).toEqual([])
  })

  it('updateExerciseName rewrites name.custom on the envelope entity', async () => {
    const existing = {
      id: 'ex-1',
      name: { custom: 'Old Name' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const d = deps({ 'ex-1': existing })
    const res = await service(d).updateExerciseName('ex-1', 'New Name')

    expect(res).toEqual({ id: 'ex-1' })
    const sent = d.put.mock.calls[0][0]._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.name).toEqual({ custom: 'New Name' })
    expect(sent.lastChanged).toBe(clock())
  })

  it('updateExerciseName throws EntityNotFoundError for unknown ids and skips the PUT', async () => {
    const d = deps({})
    await expect(service(d).updateExerciseName('ex-missing', 'X')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })

  it('updateExerciseName refuses archived (hidden) definitions', async () => {
    const d = deps({
      'ex-archived': { id: 'ex-archived', name: { custom: 'Gone' }, isHidden: true },
    })
    await expect(service(d).updateExerciseName('ex-archived', 'X')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })

  it('archiveExercise soft-deletes (isHidden cascade) on the envelope entity', async () => {
    const existing = {
      id: 'ex-1',
      name: { custom: 'Hack Squat' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const d = deps({ 'ex-1': existing })
    const res = await service(d).archiveExercise('ex-1')

    expect(res).toEqual({ id: 'ex-1', archived: true })
    const sent = d.put.mock.calls[0][0]._embedded.measurement[0]
    expect(sent.id).toBe('ex-1')
    expect(sent.isHidden).toBe(true)
    expect(sent.lastChanged).toBe(clock())
    // Soft delete keeps the rest of the entity intact.
    expect(sent.name).toEqual({ custom: 'Hack Squat' })
  })

  it('archiveExercise throws EntityNotFoundError for unknown ids', async () => {
    const d = deps({})
    await expect(service(d).archiveExercise('ex-missing')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TemplateWriteService (sc-ho9c)
// ============================================================================

const squat = {
  id: 'ex-1',
  measurementType: 'EXERCISE',
  name: { custom: 'Squat' },
  cellTypeConfigs: [
    { cellType: 'REPS', mandatory: true, isExponent: false, index: 0 },
    { cellType: 'BARBELL_WEIGHT', mandatory: false, isExponent: false, index: 1 },
  ],
}

const myTemplates = {
  id: 'folder-my-templates',
  name: { custom: 'My Templates' },
  isHidden: false,
  _links: { template: [] },
}

function templateSnapshot(
  opts: {
    measurements?: Record<string, unknown>
    folders?: Record<string, unknown>
    templates?: Record<string, unknown>
  } = {},
): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(opts.measurements ?? {})) {
    s.entities.measurement[id] = entity as never
  }
  for (const [id, entity] of Object.entries(opts.folders ?? {})) {
    s.entities.folder[id] = entity as never
  }
  for (const [id, entity] of Object.entries(opts.templates ?? {})) {
    s.entities.template[id] = entity as never
  }
  s.preferences = { weightUnit: { 'user-1': 'KILOGRAMS' } }
  return s
}

function templateDeps(s: Snapshot): WriteDeps & {
  put: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(async () => s)
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist }
}

function templateService(d: WriteDeps): TemplateWriteService {
  return new TemplateWriteService({ engine: new WriteEngine(d), clock, userId: 'user-1' })
}

const createInput = {
  name: 'Push Day',
  exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 60 }] }],
}

describe('TemplateWriteService', () => {
  it('createTemplate PUTs a TEMPLATE entity and links it into the default folder', async () => {
    const s = templateSnapshot({
      measurements: { 'ex-1': squat },
      folders: { 'folder-my-templates': myTemplates },
    })
    const d = templateDeps(s)
    const res = await templateService(d).createTemplate(createInput)

    expect(res.name).toBe('Push Day')
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)

    const envelope = d.put.mock.calls[0][0]
    expect(envelope.id).toBe('user-1')
    const sent = envelope._embedded.template[0]
    expect(sent.id).toBe(res.id)
    expect(sent.logType).toBe('TEMPLATE')
    expect(sent.name).toEqual({ custom: 'Push Day' })
    expect(sent.isHidden).toBe(false)
    // Folder change travels in the same envelope.
    const folderSent = envelope._embedded.folder[0]
    expect(folderSent.id).toBe('folder-my-templates')
    expect(folderSent._links.template).toEqual([{ href: `/api/users/user-1/templates/${res.id}` }])
    // Unchanged collections are empty arrays.
    expect(envelope._embedded.log).toEqual([])
    expect(envelope._embedded.measurement).toEqual([])
  })

  it('createTemplate honors an explicit --folder', async () => {
    const s = templateSnapshot({
      measurements: { 'ex-1': squat },
      folders: {
        'folder-other': {
          id: 'folder-other',
          name: { custom: 'Other' },
          isHidden: false,
          _links: { template: [] },
        },
      },
    })
    const d = templateDeps(s)
    const res = await templateService(d).createTemplate({
      ...createInput,
      folderId: 'folder-other',
    })
    const folderSent = d.put.mock.calls[0][0]._embedded.folder[0]
    expect(folderSent.id).toBe('folder-other')
    expect(folderSent._links.template).toEqual([{ href: `/api/users/user-1/templates/${res.id}` }])
  })

  it('createTemplate throws EntityNotFoundError for an unknown folder and skips the PUT', async () => {
    const s = templateSnapshot({ measurements: { 'ex-1': squat } })
    const d = templateDeps(s)
    await expect(
      templateService(d).createTemplate({ ...createInput, folderId: 'folder-missing' }),
    ).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(d.put).not.toHaveBeenCalled()
  })

  it('createTemplate with no folders sends no folder change', async () => {
    const s = templateSnapshot({ measurements: { 'ex-1': squat } })
    const d = templateDeps(s)
    await templateService(d).createTemplate(createInput)
    const envelope = d.put.mock.calls[0][0]
    expect(envelope._embedded.folder).toEqual([])
    expect(envelope._embedded.template).toHaveLength(1)
  })

  it('updateTemplateName rewrites name.custom on the envelope entity', async () => {
    const existing = {
      id: 'tpl-1',
      logType: 'TEMPLATE',
      name: { custom: 'Old' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const s = templateSnapshot({ templates: { 'tpl-1': existing } })
    const d = templateDeps(s)
    const res = await templateService(d).updateTemplateName('tpl-1', 'New')

    expect(res).toEqual({ id: 'tpl-1' })
    const sent = d.put.mock.calls[0][0]._embedded.template[0]
    expect(sent.name).toEqual({ custom: 'New' })
    expect(sent.lastChanged).toBe(clock())
  })

  it('updateTemplateName throws EntityNotFoundError for unknown ids', async () => {
    const d = templateDeps(templateSnapshot({}))
    await expect(templateService(d).updateTemplateName('tpl-missing', 'X')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })

  it('deleteTemplate soft-deletes the template and unlinks it from its folder', async () => {
    const existing = {
      id: 'tpl-1',
      logType: 'TEMPLATE',
      name: { custom: 'Push Day' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const folderWithLink = {
      id: 'folder-my-templates',
      name: { custom: 'My Templates' },
      isHidden: false,
      _links: { template: [{ href: '/api/users/user-1/templates/tpl-1' }] },
    }
    const s = templateSnapshot({
      templates: { 'tpl-1': existing },
      folders: { 'folder-my-templates': folderWithLink },
    })
    const d = templateDeps(s)
    const res = await templateService(d).deleteTemplate('tpl-1')

    expect(res).toEqual({ id: 'tpl-1', deleted: true })
    const envelope = d.put.mock.calls[0][0]
    const sent = envelope._embedded.template[0]
    expect(sent.id).toBe('tpl-1')
    expect(sent.isHidden).toBe(true)
    const folderSent = envelope._embedded.folder[0]
    expect(folderSent.id).toBe('folder-my-templates')
    expect(folderSent._links.template).toEqual([])
  })

  it('deleteTemplate with no containing folder sends only the template change', async () => {
    const existing = {
      id: 'tpl-1',
      logType: 'TEMPLATE',
      name: { custom: 'Push Day' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const s = templateSnapshot({ templates: { 'tpl-1': existing } })
    const d = templateDeps(s)
    await templateService(d).deleteTemplate('tpl-1')
    const envelope = d.put.mock.calls[0][0]
    expect(envelope._embedded.template).toHaveLength(1)
    expect(envelope._embedded.folder).toEqual([])
  })

  it('deleteTemplate unlinks from a hidden (soft-deleted) folder too', async () => {
    const existing = {
      id: 'tpl-1',
      logType: 'TEMPLATE',
      name: { custom: 'Push Day' },
      isHidden: false,
      lastChanged: '2026-01-01T00:00:00.000Z',
    }
    const hiddenFolderWithLink = {
      id: 'folder-gone',
      name: { custom: 'Gone' },
      isHidden: true,
      _links: { template: [{ href: '/api/users/user-1/templates/tpl-1' }] },
    }
    const s = templateSnapshot({
      templates: { 'tpl-1': existing },
      folders: { 'folder-gone': hiddenFolderWithLink },
    })
    const d = templateDeps(s)
    await templateService(d).deleteTemplate('tpl-1')
    const envelope = d.put.mock.calls[0][0]
    const folderSent = envelope._embedded.folder[0]
    expect(folderSent.id).toBe('folder-gone')
    expect(folderSent.isHidden).toBe(true)
    expect(folderSent._links.template).toEqual([])
  })

  it('deleteTemplate throws EntityNotFoundError for unknown ids', async () => {
    const d = templateDeps(templateSnapshot({}))
    await expect(templateService(d).deleteTemplate('tpl-missing')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })
})
