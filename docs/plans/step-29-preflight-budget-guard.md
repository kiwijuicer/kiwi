# Step 29: Pre-flight Budget Guard

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: Step 27
Vision-Refs: 13

## Goal

Stop attempts before they burn tokens when the remaining budget cannot
cover the projected cost of the chosen model.

## Scope

- Add `estimateAttemptCostUsd({modelId, capability, contextLevel})` in
  `packages/core/src/budget-policy.ts`. Use the same per-million prices
  as `packages/adapters/src/anthropic-common.ts:priceForModel` and
  conservative token estimates per `contextLevel` (`L0=2k`, `L1=8k`,
  `L2=20k`, `L3=40k`) plus an output budget tied to capability
  (`cheap=1k`, `mid=2k`, `strong=4k`, `frontier=6k`). Constants live
  in one file with rationale comments.
- Add `assertWithinBudgetEstimate` that throws a typed
  `BudgetExceededError` when
  `remainingUsdEstimate < estimateAttemptCostUsd`.
- Call it from
  `packages/runtime/src/step-attempt-orchestrator.ts:execute` right
  after the scheduler decision and before runner invocation.
- On violation: write a `scheduler-decision`-style block with
  `status: "blocked"`, `blockedReason: "budget_estimate_exceeds_remaining"`,
  emit `scheduler_blocked` with the estimate payload, and return
  early with attempt status `Blocked`.
- Surface the new reason in `kiwi explain` output.

## Out Of Scope

- Real token counting via tiktoken. Estimate-only is sufficient for
  step-level guarding; precise accounting still happens post-run.

## Tasks

- Implement estimator + assertion.
- Integrate into orchestrator.
- Test: `tiny` budget + `frontier` capability should block instead of
  invoking the runner.

## Acceptance Criteria

- A unit test routes a `tiny` budget run with `frontier` capability to
  blocked status without entering the runner adapter.
- `final-cost-report.json` shows zero invocations for that attempt.
- `kiwi explain` prints `budget_estimate_exceeds_remaining`.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
