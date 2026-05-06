# Step 36: Parallel Step Scheduler

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: Step 35
Vision-Refs: 4.4, 6, 9

## Goal

Run independent subplans in parallel while respecting `dependsOn`,
`subPlan.maxConcurrency` and the run lock. Sequential remains the
default for single-subplan plans.

## Scope

- New module `packages/runtime/src/parallel-scheduler.ts` exporting
  `runScheduledSubPlans({ cwd, runId, maxGlobalConcurrency, attemptOptions, now })`.
- Worker pool implemented with `Promise.all` + a lightweight semaphore
  bound by both `subPlan.maxConcurrency` and a global limit (default
  `2`, configurable via `--max-concurrency` on `kiwi run`).
- Each step still goes through `runAttemptUnlocked` from
  `apps/cli/src/commands/attempt.ts` so all gating, audit and
  finalization paths remain identical.
- The sandbox already creates a per-attempt git worktree
  (`packages/sandbox/src/worktree.ts`); confirm two worktrees for
  the same run on different attempts do not clash. If they do, sequence
  worktree creation behind a per-run mutex but keep runner execution
  parallel.
- `apps/cli/src/commands/run.ts`: when `taskGraph.subPlans` exists and
  has more than one subplan, call `runScheduledSubPlans`; otherwise
  keep the sequential `for ... of` path.

## Out Of Scope

- Distributed execution.
- Cross-machine concurrency.

## Tasks

- Implement the semaphore and dependency dispatcher.
- Update `kiwi run` and the MCP `kiwi_run` tool to accept
  `maxConcurrency`.
- Tests with two subplans of two steps each, asserting interleaved
  audit timestamps.

## Acceptance Criteria

- A two-subplan synthetic plan runs in < 1.5x the longer subplan's
  wall time on CI.
- Audit log shows interleaved `step_attempt_started` events.
- Sequential single-subplan path is unchanged.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
