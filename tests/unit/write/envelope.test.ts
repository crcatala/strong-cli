import { describe, expect, it } from 'vitest'
import { buildEnvelope } from '../../../src/write/envelope.js'
import { COLLECTIONS, type Entity } from '../../../src/write/types.js'

describe('buildEnvelope', () => {
  it('embeds every collection, unchanged ones as empty arrays', () => {
    const envelope = buildEnvelope('user-1', [])
    expect(envelope).toEqual({
      id: 'user-1',
      strongAnalytics: false,
      _embedded: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
    })
    // Every collection the server knows must be present — a missing key could
    // wipe that collection server-side.
    expect(Object.keys(envelope._embedded).sort()).toEqual([...COLLECTIONS].sort())
  })

  it('groups changed entities under their collection', () => {
    const template: Entity = { id: 'tpl-1', name: { custom: 'Push Day' } }
    const log: Entity = { id: 'log-1', logType: 'WORKOUT' }
    const envelope = buildEnvelope('user-1', [
      { collection: 'template', entity: template },
      { collection: 'log', entity: log },
    ])
    expect(envelope._embedded.template).toEqual([template])
    expect(envelope._embedded.log).toEqual([log])
    expect(envelope._embedded.measuredValue).toEqual([])
  })

  it('does not mutate the input changes', () => {
    const template: Entity = { id: 'tpl-1' }
    const changes = [{ collection: 'template' as const, entity: template }]
    const envelope = buildEnvelope('user-1', changes)
    expect(envelope._embedded.template?.[0]).toBe(template)
    expect(changes).toHaveLength(1)
  })
})
