---
id: sc-akkf
status: closed
deps: []
links: []
created: 2026-08-06T21:04:54Z
type: feature
priority: 4
assignee: cc-vps
tags: [api, write, research]
---
# explore: write API (envelope-PUT sync) behind an explicit flag

PLAN.md Future work + Key decision 4: the CLI is deliberately read-only (Strong writes are undocumented, ToS gray zone, account-termination risk from prior community history). This ticket explores implementing writes (envelope-PUT sync of changed logs/templates per docs/api-inventory.md PUT /api/users/{userId}) behind an explicit opt-in flag, without changing the default read-only posture.

## Design

Reference: jerhinesmith/strong-mcp (MIT — patterns can be adapted; note its license) documents the write envelope protocol: PUT /api/users/{userId} with body {id: userId, strongAnalytics: false, _embedded: {log: [...], template: [...], ...}} containing changed entities. Steps: (1) reproduce the envelope with a synthetic/personal test account only (NEVER the main account — verify with the maintainer); (2) add a write method on StrongClient gated behind an explicit CLI flag (e.g. strong sync --write or a WARN-gated subcommand); (3) document risks in help + README. AMBIGUITY — requires human input before implementation: whether write support is wanted at all (PLAN.md documents the read-only stance as a key decision), which entities to support first (logs vs templates), and whether to accept account-risk for the ability to push workouts. Do not start the risky parts without maintainer sign-off on scope.

## Acceptance Criteria

A written decision from the maintainer on scope/risk appetite is recorded (ticket note). If approved: write path implemented behind an explicit flag, tested only against a disposable account, defaults remain read-only, docs updated with risk warnings. If declined: ticket closed with the decision documented.

## Notes

**2026-08-07T11:35:00Z**

Maintainer decision: **no write support at this time.** Read-only is the intended purpose of this tool; the ToS gray zone and account-risk are not worth it for the current use case. Write API exploration (envelope-PUT sync per docs/api-inventory.md) remains PLAN.md future work and may be revisited if needs change. Closing with the decision documented (acceptance branch: declined).

