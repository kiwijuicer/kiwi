# Step 08: Provider Retries and Cost Ledger

Status: TODO
Done-Date: -
Milestone: MVP 2
Depends-On: Step 07
Vision-Refs: 8, 13, 17.2

## Goal

Add bounded provider retry behavior and basic cost accounting for planning.

## Scope

- Add deterministic retry wrapper for invalid provider output.
- Add initial usage and cost metadata contracts.
- Persist cost reports as artifacts where applicable.
- Add audit events for provider selection, retry, validation failure, and final success/failure.
- Record budget profile and remaining-budget metadata for later scheduler use.

## Out Of Scope

- Real provider billing integration.
- Execution costs.
- Advanced scheduler optimization.
- Active routing changes based on budget.

## Tasks

- Define max retry policy for planner provider calls.
- Store retry attempts and validation errors in planner output metadata.
- Add cost ledger write/read APIs.
- Add budget profile defaults.
- Add tests for retry limit, invalid outputs, and cost metadata persistence.
- Preserve `risk > budget` as an invariant for later scheduling.

## Acceptance Criteria

- Invalid provider output retries are bounded.
- Final invalid output fails with structured evidence.
- Cost metadata is persisted even for stub providers.
- Budget metadata is available to later scheduler policy without changing safety behavior.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/adapters test`
- `pnpm --filter @ai-kiwi/core test`
- `pnpm typecheck`
