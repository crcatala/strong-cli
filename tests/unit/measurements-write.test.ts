import { describe, expect, it, vi } from 'vitest'
import { buildMeasuredValue } from '../../src/write/entity-builders.js'
import { makeClock } from '../../src/write/ids.js'
import { emptySnapshot } from '../../src/write/snapshot-store.js'
import type { Snapshot } from '../../src/write/types.js'
import { type WriteDeps, WriteEngine } from '../../src/write/write-engine.js'
import { MeasuredValueWriteService } from '../../src/write/write-service.js'

const clock = makeClock(() => 1_700_000_000_000)

function deps(values: Record<string, Record<string, unknown>> = {}) {
  const initial = emptySnapshot('user-1')
  for (const [id, value] of Object.entries(values)) {
    initial.entities.measuredValue[id] = { ...value, id } as never
  }
  const refresh = vi.fn(async () => initial)
  const put = vi.fn(async () => {})
  const persist = vi.fn(async () => {})
  return { refresh, put, persist } satisfies WriteDeps & {
    put: ReturnType<typeof vi.fn>
    persist: ReturnType<typeof vi.fn>
  }
}

function sentEntity(d: WriteDeps): Record<string, unknown> {
  const put = d.put as unknown as {
    mock: { calls: Array<[{ _embedded: { measuredValue: Array<Record<string, unknown>> } }]> }
  }
  return put.mock.calls[0][0]._embedded.measuredValue[0]
}

function service(d: WriteDeps, resync: () => Promise<Snapshot>) {
  return new MeasuredValueWriteService({
    engine: new WriteEngine(d),
    clock,
    userId: 'user-1',
    resync,
  })
}

describe('measured value builder', () => {
  it('stores weight canonically in kilograms and links the user', () => {
    const entity = buildMeasuredValue(
      { type: 'WEIGHT', value: 220, weightUnit: 'POUNDS' },
      'user-1',
      { clock },
    )
    expect(entity.value).toBeCloseTo(99.7903, 3)
    expect(entity._links).toEqual({ user: { href: '/api/users/user-1' } })
  })
})

describe('MeasuredValueWriteService', () => {
  it('logs a measured value in the measuredValue collection', async () => {
    const d = deps()
    const result = await service(d, async () => emptySnapshot('user-1')).logMeasurement(
      'BODY_FAT_PERCENTAGE',
      18,
    )
    expect(result.type).toBe('BODY_FAT_PERCENTAGE')
    expect(sentEntity(d)).toMatchObject({
      type: 'BODY_FAT_PERCENTAGE',
      value: 18,
      isHidden: false,
    })
  })

  it('soft-deletes and reports server confirmation', async () => {
    const d = deps({ 'mv-1': { id: 'mv-1', type: 'WEIGHT', value: 80, isHidden: false } })
    const fresh = emptySnapshot('user-1')
    fresh.entities.measuredValue['mv-1'] = { id: 'mv-1', isHidden: true }
    const result = await service(d, async () => fresh).deleteMeasurement('mv-1')
    expect(result).toEqual({ id: 'mv-1', serverConfirmed: true })
    expect(sentEntity(d)).toMatchObject({
      id: 'mv-1',
      isHidden: true,
    })
  })
})
