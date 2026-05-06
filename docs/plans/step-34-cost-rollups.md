# Step 34: Cost Rollups, Warnings, CSV Export

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 13

## Goal

Make cost transparent at the level a developer cares about: per step,
per model, with a clear warning when most usage records are
`unknown` precision. Provide a CSV export for spreadsheet analysis.

## Scope

- Extend `packages/ops/src/run-summary.ts:buildRunCompletionSummary`
  output with two new fields:
  - `byStepCostsUsd: Record<stepId, { planner: 0, executor: number, reviewer: number }>`
  - `byModelCostsUsd: Record<modelLabel, number>` (model label as
    `${capability}/${runner|accessMode|providerName|modelId}`).
- Add a `warnings: string[]` field. When
  `usagePrecision.unknown >= max(1, ceil(invocationCount / 4))`, emit
  `cost_precision_unknown_dominant` with a short hint.
- Surface in `apps/cli/src/commands/cost.ts` and
  `apps/cli/src/commands/explain.ts` outputs.
- Add `--csv` to `kiwi cost`. CSV columns:
  `phase,stepId,attemptId,modelId,providerName,accessMode,inputTokens,outputTokens,usagePrecision,estimatedCostUsd`.
  Save to `.kiwi/runs/<runId>/final/final-cost-report.csv`.
- Mirror the warning in `kiwi_cost` MCP tool result.

## Out Of Scope

- Real-time cost dashboards.

## Tasks

- Update schemas in `packages/contracts/src/execution.ts`
  (`RunCompletionSummarySchema`).
- Update `run-summary.ts` builders, the CLI printers and MCP tool
  output.
- Tests for warning trigger and CSV layout.

## Acceptance Criteria

- A run with two steps shows distinct `byStepCostsUsd` totals.
- A run dominated by `unknown` precision prints the warning.
- `kiwi cost <runId> --csv` writes a CSV with one row per
  invocation.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
