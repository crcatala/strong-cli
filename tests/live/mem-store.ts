import type { TokenState, TokenStore } from '../../src/api/token-manager.js'

/** In-memory TokenStore for tests. */
export function memStore(initial: TokenState | null = null): TokenStore {
  let state = initial
  return {
    read: async () => state,
    write: async (s: TokenState) => {
      state = s
    },
  }
}
