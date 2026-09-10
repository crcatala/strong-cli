---
id: sc-lv6v
status: closed
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


## Notes

**2026-09-10T02:21:40Z**

Live validation completed on authorized account; sanitized aggregate data only. CLI commit: 484cd98. The first export after switching from a different CLI account was a cold cache miss (cache is user-scoped; no interval full re-sync message): 35 emitted workouts; 14 attempts, 0 retries, 0 token refreshes, 12,859,699 response bytes, 7,839 ms; routes global-measurements=2 (200), user-metadata=1 (200), logs-page=11 (200). Immediate repeated export without --fresh was warm: same 35 emitted workouts; 4 attempts, 0 retries, 0 token refreshes, 772,059 response bytes, 930 ms; routes global-measurements=2 (200), logs-page=1 (200), user-metadata=1 (200). user-log-detail was absent in both reports (zero detail calls), confirming request count does not scale with the 35 emitted workouts. No 401/403/429 occurred. Cold-to-warm delta: -10 attempts, -12,087,640 bytes, -6,909 ms. Persistent global-measurement caching is justified: it would remove 2 requests per observed warm export (2 of 4 attempts, 50%); per-route byte/time savings were not separately measured. No identifiers, URLs, payloads, tokens, credentials, or raw exports were retained in this note.
