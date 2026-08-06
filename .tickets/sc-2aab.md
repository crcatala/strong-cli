---
id: sc-2aab
status: open
deps: []
links: []
created: 2026-08-06T21:04:34Z
type: task
priority: 3
assignee: cc-vps
tags: [auth, security, tech-debt]
---
# jwt: decodeJwt reads claims but never validates them

PLAN.md backlog P3. src/api/jwt.ts decodeJwt() decodes the payload and reads exp + nameidentifier but never verifies the signature (by design: token comes from our own TLS login) and performs no sanity checks on exp bounds, iat, or nbf. Accepted threat model for a personal read-only CLI today.

## Design

Revisit only if the tool is ever shared or fed third-party session files. Minimal hardening without signature verification: validate exp is a plausible future timestamp (not absurdly far out, not already expired at decode), check iat <= now + skew, and nbf <= now + skew when present. Signature verification (HS256 with the app public key) is likely not feasible without the real signing key — research what key material is available if full verification is requested. This is a defensible-defer item: the acceptance bar is documenting the decision, not necessarily implementing.

## Acceptance Criteria

Either (a) implemented sanity checks with tests for malformed/out-of-range claims, or (b) the accepted-threat-model decision is documented in the code comment + PLAN.md with a clear rationale. All existing tests pass.

