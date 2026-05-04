# Step 06: Status Command and MVP1 Hardening

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 1
Depends-On: Step 05
Vision-Refs: 8, 17.1

## Goal

Finish MVP1 with reliable status reporting and acceptance-level validation.

## Scope

- Implement `kiwi status`.
- Aggregate latest or selected run state.
- Report run status, initiative title, current plan id, step count, and artifact paths.
- Harden `kiwi init` and `kiwi plan` against invalid inputs.
- Ensure MVP1 tests are green end to end.
- Freeze MVP1 behavior before introducing provider boundaries.

## Out Of Scope

- Provider boundary.
- Execution, review, sandbox, MCP, or dashboard behavior.

## Tasks

- Add status read APIs in `packages/core`.
- Add CLI status command tests.
- Validate behavior when no runs exist.
- Validate behavior with corrupt or partial run folders.
- Add minimal docs for MVP1 commands if needed.

## Acceptance Criteria

- `kiwi status` gives a readable summary for existing runs.
- Empty state and corrupt state failures are explicit.
- MVP1 acceptance criteria in `docs/plans/mvp1.md` are satisfied.
- The full test suite and typecheck pass.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm test`
- `pnpm typecheck`
