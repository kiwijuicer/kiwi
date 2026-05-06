# Step 31: CLI Error Remediation Hints

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 14.1

## Goal

When a known error occurs, print the exact next command the user
should run instead of a bare stack.

## Scope

- Extend `apps/cli/src/commands/register-common.ts` (`handleCommandError`)
  with a `mapErrorToHelp(error)` helper that returns a user-facing
  string for known errors:
  - `NotInitializedError` -> "Run `kiwi init [--workspace ...]`."
  - `RunNotFoundError` -> "List runs with `kiwi status` or pick a different `runId`."
  - "No enabled planner model" -> "Check `.kiwi/model-registry.yaml` and run `kiwi doctor`."
  - "No reviewer model with an available access mode" -> same.
  - `BudgetExceededError` (from step 29) -> "Increase `--budget-profile` or relax risk profile."
  - generic provider errors with `code: "provider_auth"` -> "Run `claude login` (or `codex login`/`cursor-agent status`)."
- Surface chalk-colored hint after the error message; preserve the
  error message itself for debugging.
- For unknown errors, keep the current behavior (full stack on
  `--debug`, otherwise short message).

## Out Of Scope

- Restructuring `chalk`/`commander` flows.
- Changing the error class hierarchy.

## Tasks

- Add `mapErrorToHelp`.
- Wire `handleCommandError` through `register-core.ts` and
  `register-execution.ts`.
- Add Vitest snapshots for two known errors.

## Acceptance Criteria

- Running `kiwi plan ./ticket.md` in an uninitialized directory prints
  the `kiwi init` hint as a colored line.
- Running `kiwi status nonexistent_run` prints the lookup hint.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test` for CLI command behavior.
