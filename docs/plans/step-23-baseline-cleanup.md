# Step 23: Stale ESLint Baseline Cleanup

Status: COMPLETED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 16

## Goal

Remove obsolete entries from `config/eslint-baseline.json` so the gate
reflects today's tree.

## Scope

- `apps/mcp-server/src/index.ts` was split; the file now has 31 lines.
  Drop all `apps/mcp-server/src/index.ts` entries from the baseline.
- `packages/core/src/a2a-runtime.ts` was deleted in commit `216fc25`
  (a2a moved to `packages/a2a`). Drop the three `a2a-runtime.ts` rows.
- `packages/core/src/lifecycle.ts` was replaced by
  `packages/core/src/lifecycle/` files; the cited
  `listStepAttemptEvidence` lives in
  `packages/core/src/lifecycle/evidence-collection.ts`. Re-key the
  baseline entry against the new path or remove it if the function is
  already under the limit.
- `packages/core/src/step-attempt-orchestrator.ts` was moved to
  `packages/runtime/src/step-attempt-orchestrator.ts`. Re-key the two
  baseline rows (or drop them if the function is now smaller).
- Re-run `pnpm lint:baseline:init` once these orphan rows are gone so
  the snapshot reflects reality. Inspect the diff manually before
  committing.

## Out Of Scope

- Refactoring code to remove the remaining real entries
  (`runStatus` complexity, `planRun` length, `executeSandboxCommand`
  length). Those are tackled by their own dedicated steps.

## Tasks

- Edit `config/eslint-baseline.json` to drop orphan keys.
- Run `pnpm lint:eslint` and `pnpm lint:baseline` to confirm the file
  shrinks but the gate stays green.
- If an unrelated row reappears, fix the row's path/key, do not add
  back the deleted ones.

## Acceptance Criteria

- `config/eslint-baseline.json` no longer references
  `apps/mcp-server/src/index.ts`, `packages/core/src/a2a-runtime.ts`
  or `packages/core/src/lifecycle.ts`.
- `pnpm lint:baseline` passes.
- `pnpm lint:eslint` produces no new findings.

## Validation

- `pnpm lint:eslint && pnpm lint:baseline` (sandbox-safe).
- Spot diff of the JSON to confirm only stale rows were removed.
