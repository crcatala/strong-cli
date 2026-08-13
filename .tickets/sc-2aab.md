---
id: sc-2aab
status: closed
deps: []
links: []
created: 2026-08-06T21:04:34Z
type: task
priority: 3
assignee: cc-vps
tags: [auth, security, tech-debt]
---
# jwt: decodeJwt reads claims but never validates them

JWT claim-validation backlog (P3). src/api/jwt.ts decodeJwt() decodes the payload and reads exp + nameidentifier but never verifies the signature (by design: token comes from our own TLS login) and performs no sanity checks on exp bounds, iat, or nbf. Accepted threat model for a personal read-only CLI today.

## Design

Revisit only if the tool is ever shared or fed third-party session files. Minimal hardening without signature verification: validate exp is a plausible future timestamp (not absurdly far out, not already expired at decode), check iat <= now + skew, and nbf <= now + skew when present. Signature verification (HS256 with the app public key) is likely not feasible without the real signing key — research what key material is available if full verification is requested. This is a defensible-defer item: the acceptance bar is documenting the decision, not necessarily implementing.

## Acceptance Criteria

Either (a) implemented sanity checks with tests for malformed/out-of-range claims, or (b) the accepted-threat-model decision is documented in the code comment with a clear rationale. All existing tests pass.


## Notes

**2026-08-07T20:11:55Z**

Decision documented (2026-08-07) — option (b) of the acceptance criteria: the accepted threat model is now spelled out in the decodeJwt() doc comment (src/api/jwt.ts) with the rationale (token from own TLS login, personal read-only CLI, never imports third-party session files) and the revisit conditions (shared tool or external session data; at minimum exp-bounds/iat/nbf sanity checks, full signature verification infeasible without the signing key). The project documentation was updated to reflect the documented decision. Closed without code changes.
