---
id: sc-jr6z
status: open
deps: []
links: []
created: 2026-08-06T21:04:34Z
type: chore
priority: 3
assignee: cc-vps
tags: [tooling, ci, tech-debt]
---
# chore: biome.json schema pinned to 2.3.11 vs installed 2.5.7

PLAN.md backlog P3. biome.json pins $schema https://biomejs.dev/schemas/2.3.11/schema.json while the installed CLI (npx biome --version) is 2.5.7. This produces schema drift warnings and risks lint/format config drift between what CI runs and what editors use.

## Design

Run npx biome migrate in the repo root (safe, updates  and any deprecated config keys), review the diff, then verify npx biome check . and npx biome format --write are clean/no-ops. Confirm .github/workflows CI pins or ranges @biomejs/biome consistently with package.json (^2.0.0). Low risk; mostly mechanical.

## Acceptance Criteria

biome.json schema matches the installed CLI version. npx biome check . passes with zero warnings. No unrelated formatting churn in the committed diff.

