import { describe, expect, it } from 'vitest'
import { editEntityName, editSetCells, verifySetCells } from '../../../src/write/edit.js'
import { makeClock } from '../../../src/write/ids.js'
import type { Entity } from '../../../src/write/types.js'

const clock = makeClock(() => 1_700_000_000_000)

function exercise(name: string): Entity {
  return {
    id: 'ex-1',
    measurementType: 'EXERCISE',
    name: { custom: name },
    instructions: { custom: '' },
    cellTypeConfigs: [{ cellType: 'REPS', mandatory: true, isExponent: false, index: 0 }],
    isGlobal: false,
    isHidden: false,
    created: '2026-01-01T00:00:00.000Z',
    lastChanged: '2026-01-01T00:00:00.000Z',
  }
}

describe('editEntityName', () => {
  it('rewrites name.custom, bumps lastChanged, and preserves every other field', () => {
    const before = exercise('Old Name')
    const after = editEntityName(before, 'New Name', clock)

    expect(after.name).toEqual({ custom: 'New Name' })
    expect(after.lastChanged).toBe(clock())
    expect(after.id).toBe('ex-1')
    expect(after.cellTypeConfigs).toEqual(before.cellTypeConfigs)
    expect(after.isHidden).toBe(false)

    // The source entity must not be mutated (clone semantics).
    expect(before.name).toEqual({ custom: 'Old Name' })
  })

  it('creates name.custom when the entity has no name object', () => {
    const bare = { id: 'ex-2', isHidden: false } as Entity
    const after = editEntityName(bare, 'Branded', clock)
    expect(after.name).toEqual({ custom: 'Branded' })
  })
})

// ============================================================================
// editSetCells / verifySetCells (sc-iwa3 — INFERRED shape)
// ============================================================================

const deps = { clock, weightUnit: 'POUNDS' as const }

/** A minimal logged workout: one group, two working sets + rest rows. */
function workoutLog(): Entity {
  return {
    id: 'w-1',
    logType: 'WORKOUT',
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
                { id: 'c-1', cellType: 'BARBELL_WEIGHT', value: '13.6077711', isHidden: false },
                { id: 'c-2', cellType: 'REPS', value: '12', isHidden: false },
                { id: 'c-3', cellType: 'RPE', value: null, isHidden: false },
              ],
            },
            { id: 'r-1', cells: [{ id: 'c-4', cellType: 'REST_TIMER', value: '85' }] },
            {
              id: 's-2',
              cells: [
                {
                  id: 'c-5',
                  cellType: 'BARBELL_WEIGHT',
                  value: '18.143694800000002',
                  isHidden: false,
                },
                { id: 'c-6', cellType: 'REPS', value: '10', isHidden: false },
              ],
            },
          ],
        },
      ],
    },
  } as Entity
}

describe('editSetCells', () => {
  it('rewrites only the edited cells; untouched cells keep their raw strings verbatim', () => {
    const out = editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 0, reps: 8 }], deps)
    const cells = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[0].cells
    expect(cells[1].value).toBe('8') // reps edited
    expect(cells[0].value).toBe('13.6077711') // weight NOT round-tripped — byte-for-byte
    expect(cells[2].value).toBeNull()
    // second working set entirely untouched, including its raw FP weight
    const set2 = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[2].cells
    expect(set2[0].value).toBe('18.143694800000002')
    expect(out.lastChanged).toBe(clock())
  })

  it('edits weight of the SECOND working set (skipping rest-timer rows) and converts lb→kg', () => {
    const out = editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 1, weight: 135 }], deps)
    const set2 = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[2].cells
    expect(Number(set2[0].value)).toBeCloseTo(135 * 0.45359237, 6)
    expect(set2[1].value).toBe('10') // reps untouched
  })

  it('writes weight without conversion when weightUnit is KILOGRAMS', () => {
    const out = editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 0, weight: 100 }], {
      clock,
      weightUnit: 'KILOGRAMS',
    })
    const cells = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[0].cells
    expect(Number(cells[0].value)).toBe(100)
  })

  it('writes an rpe value onto the RPE cell', () => {
    const out = editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 0, rpe: 9 }], deps)
    const cells = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[0].cells
    const rpeCell = cells.find((c) => c.cellType === 'RPE')
    expect(rpeCell?.value).toBe('9')
  })

  it('throws on an out-of-range set index', () => {
    expect(() =>
      editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 5, reps: 1 }], deps),
    ).toThrow(/working set index 5 out of range/)
  })

  it('throws on an out-of-range group index', () => {
    expect(() =>
      editSetCells(workoutLog(), [{ groupIndex: 5, setIndex: 0, reps: 1 }], deps),
    ).toThrow(/group index 5 out of range/)
  })

  it('throws when an edit targets a cell type the set lacks (no silent no-op)', () => {
    // set 2 (0:1) has no RPE cell
    expect(() =>
      editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 1, rpe: 8 }], deps),
    ).toThrow(/has no RPE cell to edit/)
  })

  it('throws when an edit specifies no field at all', () => {
    expect(() => editSetCells(workoutLog(), [{ groupIndex: 0, setIndex: 0 }], deps)).toThrow(
      /specifies no reps\/weight\/rpe/,
    )
  })

  it('handles OTHER_WEIGHT machines (our broadened weight-cell set)', () => {
    const machine = {
      id: 'w-2',
      logType: 'WORKOUT',
      isHidden: false,
      _embedded: {
        cellSetGroup: [
          {
            id: 'g-1',
            cellSets: [
              {
                id: 's-1',
                cells: [
                  { id: 'c-1', cellType: 'OTHER_WEIGHT', value: '40', isHidden: false },
                  { id: 'c-2', cellType: 'REPS', value: '12', isHidden: false },
                ],
              },
            ],
          },
        ],
      },
    } as Entity
    const out = editSetCells(machine, [{ groupIndex: 0, setIndex: 0, weight: 50, reps: 10 }], {
      clock,
      weightUnit: 'KILOGRAMS',
    })
    const cells = (
      out as {
        _embedded: {
          cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
        }
      }
    )._embedded.cellSetGroup[0].cellSets[0].cells
    expect(cells[0].value).toBe('50')
    expect(cells[1].value).toBe('10')
  })

  it('does not mutate the input entity', () => {
    const input = workoutLog()
    const before = JSON.stringify(input)
    editSetCells(input, [{ groupIndex: 0, setIndex: 0, reps: 99 }], deps)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('verifySetCells', () => {
  const vdeps = { weightUnit: 'POUNDS' as const }

  it('confirms an edit round-trips through editSetCells (server truth == what we wrote)', () => {
    const edits = [{ groupIndex: 0, setIndex: 0, reps: 8 }]
    const orig = workoutLog()
    const written = editSetCells(orig, edits, deps)
    expect(verifySetCells(orig, written, edits, vdeps)).toBe(true)
  })

  it('confirms a weight edit despite kg float storage (epsilon compare)', () => {
    const edits = [{ groupIndex: 0, setIndex: 1, weight: 135 }]
    const orig = workoutLog()
    const written = editSetCells(orig, edits, deps)
    expect(verifySetCells(orig, written, edits, vdeps)).toBe(true)
  })

  it('confirms an RPE edit (edited from a null starting value)', () => {
    const edits = [{ groupIndex: 0, setIndex: 0, rpe: 9 }]
    const orig = workoutLog()
    const written = editSetCells(orig, edits, deps)
    expect(verifySetCells(orig, written, edits, vdeps)).toBe(true)
  })

  it('returns false when the reps value does not match the intended edit', () => {
    const orig = workoutLog()
    expect(verifySetCells(orig, orig, [{ groupIndex: 0, setIndex: 0, reps: 8 }], vdeps)).toBe(false)
  })

  it('tolerates a numeric server value for reps (string-normalized compare)', () => {
    const server = workoutLog() as {
      _embedded: {
        cellSetGroup: { cellSets: { cells: { cellType: string; value: string | null }[] }[] }[]
      }
    }
    server._embedded.cellSetGroup[0].cellSets[0].cells[1].value = 8 as unknown as string
    expect(
      verifySetCells(workoutLog(), server, [{ groupIndex: 0, setIndex: 0, reps: 8 }], vdeps),
    ).toBe(true)
  })

  it('returns false when the entity is undefined', () => {
    expect(
      verifySetCells(workoutLog(), undefined, [{ groupIndex: 0, setIndex: 0, reps: 8 }], vdeps),
    ).toBe(false)
  })

  it('returns false when a group or set index is out of range', () => {
    const orig = workoutLog()
    const w = editSetCells(orig, [{ groupIndex: 0, setIndex: 0, reps: 8 }], deps)
    expect(verifySetCells(orig, w, [{ groupIndex: 9, setIndex: 0, reps: 8 }], vdeps)).toBe(false)
    expect(verifySetCells(orig, w, [{ groupIndex: 0, setIndex: 9, reps: 8 }], vdeps)).toBe(false)
  })

  it('returns false when server truth has a different SHAPE (collateral corruption)', () => {
    const edits = [{ groupIndex: 0, setIndex: 0, reps: 8 }]
    const orig = workoutLog()
    const written = editSetCells(orig, edits, deps)
    // simulate the server dropping the second working set entirely
    const mangled = structuredClone(written) as {
      _embedded: { cellSetGroup: { cellSets: unknown[] }[] }
    }
    mangled._embedded.cellSetGroup[0].cellSets.pop()
    expect(verifySetCells(orig, mangled, edits, vdeps)).toBe(false)
    // sanity: the un-mangled document still confirms
    expect(verifySetCells(orig, written, edits, vdeps)).toBe(true)
  })

  it('returns false when the target set has no cell of the edited type', () => {
    const edits = [{ groupIndex: 0, setIndex: 1, rpe: 8 }] // set 2 has no RPE cell
    const orig = workoutLog()
    expect(verifySetCells(orig, orig, edits, vdeps)).toBe(false)
  })

  it('skips the rest-timer cellSet just like editSetCells (setIndex 1 == second WORKING set)', () => {
    const edits = [{ groupIndex: 0, setIndex: 1, reps: 3 }]
    const orig = workoutLog()
    const written = editSetCells(orig, edits, deps)
    expect(verifySetCells(orig, written, edits, vdeps)).toBe(true)
  })
})
