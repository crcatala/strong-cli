---
id: sc-lv6v
status: open
deps: [sc-1i5v, sc-za3e]
links: []
created: 2026-09-10T00:33:31Z
type: task
priority: 2
assignee: cc-vps
tags: [phase-2, validation, performance, api-safety]
---
# Measure and document the live request profile of bulk workout export

After the filtered bulk export and safe HTTP statistics ship, validate the expected request reduction against the live service. The goal is to distinguish verified request counts from estimates and establish whether remaining paginated global-measurement traffic warrants persistent caching. This ticket is measurement and documentation, not an invitation to load-test the service.

## Design

Use an authorized account with a warm workout cache and a representative multi-workout date range. Run one bounded bulk export with HTTP statistics enabled. If safe, compare cold versus repeated runs without --fresh; never run concurrent traffic or an artificial stress test. Record only sanitized aggregate counts, bytes, timings, cache provenance, CLI version/commit, and broad workout-count bucket. Do not commit account identifiers, continuation tokens, raw URLs, payloads, or credentials.

## Acceptance Criteria

- A bounded live run records sanitized totals for log pages, user metadata, global measurement pages, detail calls, retries, refreshes, bytes, and elapsed time.
- Evidence confirms that individual detail-call count is zero and request count does not scale with workouts emitted.
- The result identifies cold/warm workout-cache state and whether a token refresh or retry affected totals.
- No sensitive account data, raw payloads, identifiers, or credentials are committed.
- A note records whether a persistent global-measurement cache is justified, with measured expected savings.
- Any 401/403/429 stops the validation rather than triggering repeated manual reruns.

