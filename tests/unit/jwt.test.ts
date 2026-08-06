import { describe, expect, it } from 'vitest'
import { decodeJwt } from '../../src/api/jwt.js'
import { fakeJwt } from '../helpers/fixtures.js'

const exp = Math.floor(Date.now() / 1000) + 600

describe('decodeJwt', () => {
  it('extracts exp and the Strong nameidentifier claim', () => {
    const token = fakeJwt({
      exp,
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'user-42',
    })
    const decoded = decodeJwt(token)
    expect(decoded.expMs).toBe(exp * 1000)
    expect(decoded.userId).toBe('user-42')
  })

  it('handles missing userId claim', () => {
    const decoded = decodeJwt(fakeJwt({ exp: 123 }))
    expect(decoded.userId).toBeUndefined()
    expect(decoded.expMs).toBe(123000)
  })

  it('rejects malformed tokens', () => {
    expect(() => decodeJwt('not-a-jwt')).toThrow()
    expect(() => decodeJwt('a.b.c')).toThrow()
  })

  it('rejects tokens without exp', () => {
    expect(() => decodeJwt(fakeJwt({ foo: 'bar' }))).toThrow(/exp/)
  })
})
