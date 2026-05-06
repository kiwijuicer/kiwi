# Step 35: First-class SubPlans in Planner Output

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 4.3, 4.4, 9

## Goal

Use `SubPlanSchema` for real. Today the field exists in
`packages/contracts/src/domain.ts` but `buildDeterministicTaskGraph`
emits a flat `steps[]` only and no provider tool schema knows about
`subPlans`.

## Scope

- Update `packages/core/src/planner.ts:buildDeterministicTaskGraph` so
  it groups consecutive `dependsOn`-free steps into a single
  `subplan_<index>` and assigns dependent steps to their predecessor's
  subplan (one chain per subplan, parallel-friendly when steps are
  independent). `maxConcurrency` defaults to `1` until step 36 wires
  the parallel scheduler.
- Update the Anthropic + Claude Code planner tool schemas
  (`packages/adapters/src/prompts/planner/v1/tool-schema.ts`) so the
  LLM may return `subPlans`. The schema must keep the existing
  `steps[]` required and add an optional
  `subPlans[]` with `subPlanId`, `title`, `stepIds`, `dependsOn`,
  `maxConcurrency`.
- Persist `subPlans` in `task-graph.json` (already covered by
  `TaskGraphSchema`) and surface them in `kiwi status` /
  `kiwi explain` outputs as a tree.

## Out Of Scope

- Actually running subplans in parallel - that is step 36.

## Tasks

- Adjust the deterministic planner heuristic.
- Update planner prompts.
- Extend status/explain printers.
- Unit tests covering: linear chain becomes one subplan; two
  independent chains become two subplans.

## Acceptance Criteria

- `task-graph.json` contains `subPlans` for fixtures with multiple
  independent chains.
- Live planner provider can return subPlans without breaking schema
  validation.
- `kiwi status <runId>` prints a tree showing subplans.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
