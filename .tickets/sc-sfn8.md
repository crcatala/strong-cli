---
id: sc-sfn8
status: open
deps: []
links: []
created: 2026-08-07T04:41:58Z
type: feature
priority: 3
assignee: cc-vps
tags: [features, api]
---
# feat: folders/tags listing commands

Follow-up to sc-g3iw (templates portion shipped as strong templates in PR chore/quick-wins). Folders and tags listing remain. docs/api-inventory.md lists folders/tags in the user doc resource list (each with collection rel + next pagination) and the user endpoint supports include=tag / include=folder. AMBIGUITY: exact response shape for tag/folder entities is unverified — an agent should confirm against the live API (RUN_LIVE_TESTS=1 or a disposable account) and the reference impls in PLAN.md (esp. ivanvmoreno/strong-skill endpoint map) before wiring types. Intended UX (what the CLI should show for folders/tags — counts? memberships?) needs maintainer input.

## Design

Follow the strong templates pattern (src/commands/templates.ts): auth via client.tokenManager.load(), fetch via the user endpoint include=tag|folder or dedicated endpoints once confirmed, rows with id+name, json/plain/table output via src/cli/output.ts, templateName-style name helper in src/transform/workouts.ts. Add types to src/api/types.ts (Tag/Folder currently unknown[] in UserResponse._embedded).

## Acceptance Criteria

Folder and/or tag commands wired to confirmed live API shapes. Types, name helpers, and tests added. Docs updated. Existing tests pass.

