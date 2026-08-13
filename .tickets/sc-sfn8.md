---
id: sc-sfn8
status: closed
deps: []
links: []
created: 2026-08-07T04:41:58Z
type: feature
priority: 3
assignee: cc-vps
tags: [features, api]
---
# feat: folders/tags listing commands

Follow-up to sc-g3iw (templates portion shipped as strong templates in PR chore/quick-wins). Folders and tags listing remain. docs/api-inventory.md lists folders/tags in the user doc resource list (each with collection rel + next pagination) and the user endpoint supports include=tag / include=folder. AMBIGUITY: exact response shape for tag/folder entities is unverified — an agent should confirm against the live API (RUN_LIVE_TESTS=1 or a disposable account) and the documented reference implementations (especially ivanvmoreno/strong-skill's endpoint map) before wiring types. Intended UX (what the CLI should show for folders/tags — counts? memberships?) needs maintainer input.

## Design

Follow the strong templates pattern (src/commands/templates.ts): auth via client.tokenManager.load(), fetch via the user endpoint include=tag|folder or dedicated endpoints once confirmed, rows with id+name, json/plain/table output via src/cli/output.ts, templateName-style name helper in src/transform/workouts.ts. Add types to src/api/types.ts (Tag/Folder currently unknown[] in UserResponse._embedded).

## Acceptance Criteria

Folder and/or tag commands wired to confirmed live API shapes. Types, name helpers, and tests added. Docs updated. Existing tests pass.

## Notes

**2026-08-07T12:00:00Z**

Shipped in PR (chore/polish-cache-retry-folders-config) — Phase 1 minimal lists (maintainer-approved UX: id + name, json/plain/table, --search/--limit mirroring `strong templates`). **Live shapes verified against the real account (2026-08-07)**: `include=tag` → `{id, name:{en}, color, isGlobal, created, _links.measurement[]}` (10 tags); `include=folder` → `{id, name:{en}, index, isGlobal, created, lastChanged, _links.template[]}` (3 folders). Types `Tag`/`Folder` added (UserResponse._embedded now typed), `StrongClient.getTags/getFolders`, `tagName`/`folderName` helpers (shared `nameOrId` with templateName), `strong tags` / `strong folders` commands, registered in program.ts, README and project documentation updated. Counts/memberships deliberately not shown (inert without filtering); possible follow-up: `--tag` filter on workouts/stats/export if the log↔tag mapping proves useful. Closed.

