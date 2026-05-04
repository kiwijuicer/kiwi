# Step 07: Planner Provider Boundary

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 2
Depends-On: Step 06
Vision-Refs: 6.1, 13, 17.2

## Goal

Introduce the smallest MVP2 provider boundary without real external LLM dependency.

## Scope

- Add provider-facing planner contracts in `packages/adapters`.
- Define `PlannerProvider` input and output.
- Implement `StubPlannerProvider` backed by the deterministic planner.
- Validate provider output against `TaskGraphSchema`.
- Persist `planner-input.json` and `planner-output.json`.
- Keep real provider selection behind config, defaulting to the stub provider.

## Out Of Scope

- Real OpenAI, Anthropic, or other provider SDK calls.
- Streaming.
- Runner execution.
- Sandbox runtime.

## Tasks

- Add typed provider interfaces.
- Route `kiwi plan` through the provider boundary.
- Keep local-first deterministic behavior as default.
- Capture provider metadata needed for retries and future cost tracking.
- Add tests for valid and invalid provider output.

## Acceptance Criteria

- Planning still works offline and deterministically.
- Provider output is never trusted without schema validation.
- Planner input and output artifacts are persisted under the run plan folder.
- `core` does not import provider-specific SDKs.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/adapters test`
- `pnpm --filter @kiwi/core test`
- `pnpm typecheck`
