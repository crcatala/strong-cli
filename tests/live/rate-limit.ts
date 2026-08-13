/** Serialize live requests and enforce a minimum gap between them. */
export function createRateLimitedFetch(
  fetchImpl: typeof fetch,
  minimumDelayMs: number,
): typeof fetch {
  let nextRequestAt = 0
  let queue = Promise.resolve()

  return async (...args) => {
    const request = queue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - Date.now())
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
      nextRequestAt = Date.now() + minimumDelayMs
      return fetchImpl(...args)
    })
    queue = request.then(
      () => undefined,
      () => undefined,
    )
    return request
  }
}
