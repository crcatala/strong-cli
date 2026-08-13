import { describe, expect, it, vi } from 'vitest'
import { makeClock } from '../../../src/write/ids.js'
import { emptySnapshot } from '../../../src/write/snapshot-store.js'
import type { Snapshot } from '../../../src/write/types.js'
import { type WriteDeps, WriteEngine } from '../../../src/write/write-engine.js'
import {
  EntityNotFoundError,
  ExerciseWriteService,
  TemplateWriteService,
  WorkoutWriteService,
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

// ============================================================================
// WorkoutWriteService (sc-iwa3)
// ============================================================================

function workoutSnapshot(
  opts: { measurements?: Record<string, unknown>; logs?: Record<string, unknown> } = {},
): Snapshot {
  const s = emptySnapshot('user-1')
  for (const [id, entity] of Object.entries(opts.measurements ?? {})) {
    s.entities.measurement[id] = entity as never
  }
  for (const [id, entity] of Object.entries(opts.logs ?? {})) {
    s.entities.log[id] = entity as never
  }
  s.preferences = { weightUnit: { 'user-1': 'KILOGRAMS' } }
  return s
}

function workoutDeps(s: Snapshot): WriteDeps & {
  put: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(async () => s)
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist }
}

function workoutService(
  d: WriteDeps,
  resync: () => Promise<Snapshot> = async () => emptySnapshot('user-1'),
  reconcile?: (fresh: Snapshot) => Promise<void> | void,
): WorkoutWriteService {
  return new WorkoutWriteService({
    engine: new WriteEngine(d),
    clock,
    userId: 'user-1',
    resync,
    ...(reconcile ? { reconcile } : {}),
  })
}

const logInput = {
  name: 'Push Day',
  exercises: [{ exerciseId: 'ex-1', sets: [{ reps: 10, weight: 60 }] }],
}

/** A logged workout with one group, one working set + a rest row. */
function seededWorkout(): Record<string, unknown> {
  return {
    id: 'w-1',
    logType: 'WORKOUT',
    name: { custom: 'Push Day' },
    isHidden: false,
    lastChanged: '2026-01-01T00:00:00.000Z',
    _embedded: {
      cellSetGroup: [
        {
          id: 'g-1',
          cellSets: [
            {
              id: 's-1',
              cells: [
                { id: 'c-1', cellType: 'BARBELL_WEIGHT', value: '60', isHidden: false },
                { id: 'c-2', cellType: 'REPS', value: '10', isHidden: false },
                { id: 'c-3', cellType: 'RPE', value: null, isHidden: false },
              ],
            },
            { id: 'r-1', cells: [{ id: 'c-4', cellType: 'REST_TIMER', value: '85' }] },
          ],
        },
      ],
    },
  }
}

describe('WorkoutWriteService.logWorkout', () => {
  it('PUTs a WORKOUT log entity and applies it to the snapshot', async () => {
    const s = workoutSnapshot({ measurements: { 'ex-1': squat } })
    const d = workoutDeps(s)
    const res = await workoutService(d).logWorkout(logInput)

    expect(res.name).toBe('Push Day')
    expect(res.exercises).toBe(1)
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)

    const envelope = d.put.mock.calls[0][0]
    expect(envelope.id).toBe('user-1')
    const sent = envelope._embedded.log[0]
    expect(sent.id).toBe(res.id)
    expect(sent.logType).toBe('WORKOUT')
    expect(sent.name).toEqual({ custom: 'Push Day' })
    expect(sent.isHidden).toBe(false)
    expect(sent.startDate).toBe(clock())
    expect(sent.endDate).toBe(clock())
    expect(sent._links.template).toBeUndefined()
    // Working set is marked completed for a WORKOUT.
    expect(sent._embedded.cellSetGroup[0].cellSets[0].isCompleted).toBe(true)
    // Unchanged collections travel as empty arrays.
    expect(envelope._embedded.template).toEqual([])
    expect(envelope._embedded.measurement).toEqual([])
    // Optimistic merge applied the new log to the snapshot.
    expect(Object.keys(s.entities.log)).toContain(res.id)
  })

  it('links a template when templateId is supplied', async () => {
    const s = workoutSnapshot({ measurements: { 'ex-1': squat } })
    const d = workoutDeps(s)
    await workoutService(d).logWorkout({ ...logInput, templateId: 'tpl-1' })
    const sent = d.put.mock.calls[0][0]._embedded.log[0]
    expect(sent._links.template).toEqual({ href: '/api/users/user-1/templates/tpl-1' })
  })

  it('throws for an exercise id absent from the snapshot and skips the PUT', async () => {
    const d = workoutDeps(workoutSnapshot({}))
    await expect(
      workoutService(d).logWorkout({
        name: 'X',
        exercises: [{ exerciseId: 'ex-missing', sets: [{ reps: 10, weight: 0 }] }],
      }),
    ).rejects.toThrow(/Unknown exercise id "ex-missing"/)
    expect(d.put).not.toHaveBeenCalled()
  })
})

describe('WorkoutWriteService.deleteWorkout', () => {
  it('soft-deletes a logged workout (cascading isHidden)', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const res = await workoutService(d).deleteWorkout('w-1')

    expect(res).toEqual({ id: 'w-1', deleted: true })
    const sent = d.put.mock.calls[0][0]._embedded.log[0]
    expect(sent.id).toBe('w-1')
    expect(sent.isHidden).toBe(true)
    expect(sent.lastChanged).toBe(clock())
    // Cascade hides the cellSetGroup/cellSet/cell rows too.
    const group = sent._embedded.cellSetGroup[0]
    expect(group.isHidden).toBe(true)
    expect(group.cellSets[0].isHidden).toBe(true)
    expect(group.cellSets[0].cells[0].isHidden).toBe(true)
  })

  it('throws EntityNotFoundError for unknown ids and skips the PUT', async () => {
    const d = workoutDeps(workoutSnapshot({}))
    await expect(workoutService(d).deleteWorkout('w-missing')).rejects.toBeInstanceOf(
      EntityNotFoundError,
    )
    expect(d.put).not.toHaveBeenCalled()
  })
})

describe('WorkoutWriteService.updateWorkoutSets (inferred + verified)', () => {
  it('edits the targeted cell, preserves untouched cells verbatim, and confirms via re-sync', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    // Default resync echoes the optimistically-updated snapshot (write landed).
    const res = await workoutService(d, async () => s).updateWorkoutSets('w-1', [
      { groupIndex: 0, setIndex: 0, reps: 8 },
    ])

    expect(res.id).toBe('w-1')
    expect(res.serverConfirmed).toBe(true)
    const cells =
      d.put.mock.calls[0][0]._embedded.log[0]._embedded.cellSetGroup[0].cellSets[0].cells
    expect(cells[1].value).toBe('8') // reps edited
    expect(cells[0].value).toBe('60') // untouched weight preserved byte-for-byte
  })

  it('converts a weight edit to kg in the PUT and confirms it', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const res = await workoutService(d, async () => s).updateWorkoutSets('w-1', [
      { groupIndex: 0, setIndex: 0, weight: 100 },
    ])
    const cells =
      d.put.mock.calls[0][0]._embedded.log[0]._embedded.cellSetGroup[0].cellSets[0].cells
    expect(Number(cells[0].value)).toBe(100) // KILOGRAMS prefs -> no conversion
    expect(res.serverConfirmed).toBe(true)
  })

  it('reports serverConfirmed:false when re-synced server truth lacks the edit', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    // Server truth still shows the OLD reps (edit did not land).
    const stale = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const res = await workoutService(d, async () => stale).updateWorkoutSets('w-1', [
      { groupIndex: 0, setIndex: 0, reps: 8 },
    ])
    expect(res.serverConfirmed).toBe(false)
  })

  it('reports serverConfirmed:undefined (never throws) when the re-sync fails', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const res = await workoutService(d, async () => {
      throw new Error('network down')
    }).updateWorkoutSets('w-1', [{ groupIndex: 0, setIndex: 0, reps: 8 }])
    expect(res.id).toBe('w-1')
    expect(res.serverConfirmed).toBeUndefined()
  })

  it('throws when the workout id is not visible', async () => {
    const d = workoutDeps(workoutSnapshot({}))
    await expect(
      workoutService(d).updateWorkoutSets('w-missing', [{ groupIndex: 0, setIndex: 0, reps: 8 }]),
    ).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(d.put).not.toHaveBeenCalled()
  })

  it('throws on a bad set index before any PUT', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    await expect(
      workoutService(d).updateWorkoutSets('w-1', [{ groupIndex: 0, setIndex: 9, reps: 8 }]),
    ).rejects.toThrow(/out of range/)
    expect(d.put).not.toHaveBeenCalled()
  })

  it('reconciles the snapshot to pristine server truth when an edit is unconfirmed', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const reconcile = vi.fn(async () => {})
    // Server truth still shows the OLD reps (edit did not land).
    const stale = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const res = await workoutService(d, async () => stale, reconcile).updateWorkoutSets('w-1', [
      { groupIndex: 0, setIndex: 0, reps: 8 },
    ])

    expect(res.serverConfirmed).toBe(false)
    // The optimistic (unconfirmed) edit must not stay in the persisted
    // snapshot — it is replaced by pristine server truth.
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile.mock.calls[0][0]).toBe(stale)
  })

  it('does not reconcile when the edit is confirmed (optimistic == server truth)', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const reconcile = vi.fn(async () => {})
    const res = await workoutService(d, async () => s, reconcile).updateWorkoutSets('w-1', [
      { groupIndex: 0, setIndex: 0, reps: 8 },
    ])
    expect(res.serverConfirmed).toBe(true)
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('does not reconcile when the re-sync itself fails (serverConfirmed undefined)', async () => {
    const s = workoutSnapshot({ logs: { 'w-1': seededWorkout() } })
    const d = workoutDeps(s)
    const reconcile = vi.fn(async () => {})
    const res = await workoutService(
      d,
      async () => {
        throw new Error('network down')
      },
      reconcile,
    ).updateWorkoutSets('w-1', [{ groupIndex: 0, setIndex: 0, reps: 8 }])
    expect(res.serverConfirmed).toBeUndefined()
    expect(reconcile).not.toHaveBeenCalled()
  })
})
