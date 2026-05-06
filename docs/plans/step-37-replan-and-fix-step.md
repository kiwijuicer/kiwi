# Step 37: Auto-Replan + Auto-Fix-Step

Status: DONE
Done-Date: 2026-05-06
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 9, 11.3

## Goal

Make `replan` / `fix_step` next-actions actionable. Today they are
classified by `review-engine.ts:classifyReviewAction` and printed but
nothing acts on them.

## Scope

- New module `packages/runtime/src/replanner.ts` with two functions:
  - `attemptReplan({cwd, runId, focalStepId, reviewVerdict})` -
    re-invokes the planner provider with the failing diff + verdict +
    remaining task graph and writes `task-graph.v2.json` next to the
    original. The CLI loads the latest `task-graph.v*.json` for
    follow-up runs.
  - `injectFixStep({cwd, runId, focalStepId, reviewVerdict})` -
    appends a `code_modification` step right after the failed step
    with `dependsOn: [focalStepId]` and `successCriteria` derived
    from `verdict.recommendedNextSteps`.
- CLI flags on `kiwi run`: `--auto-replan` and `--auto-fix` (default
  off). On verdict `needs_changes`, run `injectFixStep` and continue.
  On `reject`, run `attemptReplan` and stop with a clear next-step
  hint.
- New audit events: `replan_succeeded`, `replan_failed`,
  `fix_step_injected`. Add to
  `packages/core/src/cost-ledger.ts:AuditEventType`.

## Out Of Scope

- Re-running gates automatically without re-invoking the runner; we
  still treat each step attempt as the unit of work.

## Tasks

- Implement replanner + fix-step injection.
- Wire flags into `apps/cli/src/commands/run.ts`.
- Tests covering verdict `needs_changes` -> step injected; verdict
  `reject` -> replan with new task-graph version on disk.

## Acceptance Criteria

- With `--auto-fix`, a `needs_changes` verdict produces a follow-up
  `code_modification` step that the run executes.
- With `--auto-replan`, a `reject` verdict writes
  `task-graph.v2.json` and the run stops with the new plan ready.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
