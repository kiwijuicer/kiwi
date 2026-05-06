# Step 27: Capability-aware Executor Selection

Status: COMPLETED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 5.2, 9, 13

## Goal

Make the runner registry honor the scheduler's `modelCapability`
decision. Currently `pickExecutorModel` ignores it and silently picks
any available `strong || mid` model.

## Scope

- Change the signature of
  `packages/runtime/src/runner-registry.ts:pickExecutorModel` to
  `(models, env, requestedCapability)`.
- Selection rule: prefer the lowest enabled `capability >=
  requestedCapability` whose access mode is available, in the existing
  `EXECUTOR_ACCESS_MODE_ORDER`. Fall back to the first available
  `executor`-capable model otherwise. Stub stays last.
- Thread the request through `RunnerRegistry.resolve`. Add
  `requestedCapability` (default = scheduler decision) to
  `RunnerResolutionOptions`.
- Update `packages/runtime/src/planned-step-execution.ts` to pass the
  scheduler's `decision.modelCapability` (or
  `step.recommendedModelCapability` pre-decision) into the registry.
- Add a new audit event `executor_model_selected` in
  `packages/core/src/cost-ledger.ts:AuditEventType` and emit it from
  the registry once a model is chosen, including:
  `requestedCapability`, `selectedCapability`, `modelId`,
  `accessMode`, `reason` (`exact_match | escalated_for_availability |
  fell_back_to_lower | stub_fallback`).
- Surface the same reason in the `kiwi explain` output (extend
  `RunRoutingExplanation` with `executorReason`).

## Out Of Scope

- Changing planner / reviewer registries (they already have their own
  capability logic).
- Pre-flight cost checks (step 29).

## Tasks

- Refactor `pickExecutorModel`.
- Add `executor_model_selected` audit event type and emitter.
- Update tests in `packages/runtime/src/__tests__` to assert the new
  selection.
- Update `apps/cli/src/commands/explain.ts` to print the executor
  reason.

## Acceptance Criteria

- A test where the scheduler decides `cheap` selects a `cheap`/`mid`
  Haiku model, not Sonnet/Opus.
- A test where only `strong` is enabled escalates and emits
  `executor_model_selected` with reason
  `fell_back_to_lower` (or `escalated_for_availability` depending on
  direction).
- `kiwi explain <runId>` prints the new reason.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
