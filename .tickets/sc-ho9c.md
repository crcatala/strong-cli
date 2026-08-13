---
id: sc-ho9c
status: closed
deps: [sc-m3xf]
links: []
created: 2026-08-13T00:16:39Z
type: task
priority: 1
assignee: cc-vps
parent: sc-7hhn
tags: [write, api, templates]
---
# write: templates - create / rename / delete (with folder bookkeeping)

Add write commands for routine templates (the original ask). Reads already ship: strong templates (list), strong folders (list).

- Create: port buildLog('TEMPLATE') - entity is logType TEMPLATE, name.custom, cellSetGroup per exercise (cells derived from the exercise definition's cellTypeConfigs: REPS/RPE/weight cells + trailing REST_TIMER cell set), _links.user. Exercises referenced by definition id resolved from the user snapshot's measurement collection - NOT the public library; clean error on unknown id.
- Folder bookkeeping: create defaults to the 'My Templates' folder (folder id ending -my-templates, else first folder); the folder entity's _links.template array gets the new template href; delete removes it (unlinks).
- Rename: editEntityName sets name.custom.
- Delete: soft (isHidden cascade). Captured shape - no serverConfirmed verify loop needed.

## Design

strong-mcp refs (MIT): src/write/log-builder.ts (buildLog), src/write/folders.ts (defaultFolder, addTemplateToFolder, removeTemplateFromFolder, findFolderContaining), src/write/edit.ts (editEntityName), src/services/write-service.ts (createTemplate/updateTemplateName/deleteTemplate).

Our refs: src/commands/templates.ts, src/commands/folders.ts, src/transform/workouts.ts (templateName), src/api/types.ts (Template/Folder).

CLI shape (agent picks, keep consistent with the other write tickets): subcommands under the existing strong templates command, e.g. strong templates create <name> --exercise <id> --sets ... | rename <id> <name> | delete <id>. Follow existing commander registration (src/cli/program.ts) and UsageError patterns (src/cli/errors.ts). Opt-in gating per epic.

## Acceptance Criteria

Create produces a template visible via strong templates (and on the disposable account in the app / strong-mcp). Rename updates the displayed name. Delete removes it from the list AND unlinks it from its folder (folder _links verified). Unknown exercise id -> clean UsageError with 'sync or create it first' guidance. Live test on disposable account: create -> verify -> rename -> verify -> delete -> verify folder unlink.


## Notes

**2026-08-13T04:07:46Z**

Implemented: strong templates create|rename|delete with --write opt-in gating (sc-ho9c). Ports from strong-mcp (MIT): buildLog TEMPLATE kind (src/write/log-builder.ts — cellSetGroup derived from each exercise's cellTypeConfigs with trailing REST_TIMER set, weights written canonically in kg; weight-cell set broadened to include OTHER_WEIGHT/PLATE_WEIGHT so machine exercises template correctly) and folder bookkeeping (src/write/folders.ts — default 'My Templates' folder, _links.template add/remove). TemplateWriteService (src/write/write-service.ts) wired through the sc-m3xf write engine (delta-sync refresh -> envelope PUT -> optimistic merge -> persist). CLI: templates.ts restructured to parent list + create/rename/delete subcommands; help documents ToS/risk warning + disposable-account policy; README/CHANGELOG/PLAN updated. Tests: 45 new unit tests (log-builder, folders, TemplateWriteService, CLI incl. opt-in gating, set-spec parsing, unknown exercise/folder id errors); live write-flow test (create->rename->delete, verified at each step incl. folder link/unlink) gated by RUN_LIVE_WRITE_TESTS=1 + STRONG_DISPOSABLE_USER_ID. lint/build/coverage/package smoke green.
