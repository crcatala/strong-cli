---
id: sc-g3iw
status: open
deps: []
links: []
created: 2026-08-06T21:04:54Z
type: feature
priority: 3
assignee: cc-vps
tags: [features, api]
---
# feat: templates/folders/tags listing commands

PLAN.md Future work. Docs/api-inventory.md lists /api/users/{userId}/templates (Bearer, routine templates) and a public resource list including folders, templates, tags (each with collection rel + next pagination). StrongClient.getTemplates() already exists (src/api/client.ts) and userTemplatesUrl is in src/api/endpoints.ts, but there is no CLI command exposing them, and folders/tags client methods + response types do not exist yet.

## Design

Scope: add a strong templates command using the existing client method; then add folders and tags listing. Check src/api/types.ts for existing Template/Tag/Folder types (Template exists; verify Tag/Folder). Folders/tags fetch shape needs confirming against the live API (include=tag/folder on the user endpoint per docs, or dedicated endpoints — verify with RUN_LIVE_TESTS=1 and the reference impls in PLAN.md, esp. ivanvmoreno/strong-skill endpoint map). Output formats should match existing commands (json/plain/table via src/cli/output.ts). If folder/tag semantics are unclear (what the CLI should show — counts? memberships?), note the ambiguity and ask the maintainer for intended UX.

## Acceptance Criteria

At minimum a strong templates command (list + detail if sensible). Folders/tags commands if live API shape is confirmed. Types, client methods, and tests for anything added. Docs updated. Existing tests pass; live tests run where credentials available.

