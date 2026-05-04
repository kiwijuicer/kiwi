# Step 12: Runner Adapters and Step Orchestration

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 4
Depends-On: Step 11
Vision-Refs: 7.1, 7.2, 8, 11.3, 17.4

## Goal

Implement the first executable step orchestration path through runner adapters, sandbox, gates, and review.

## Scope

- Add `RunnerAdapter` contract in `packages/adapters`.
- Implement initial adapters:
  - `local-shell`
  - stub adapter for external coding runners
- Add `StepAttemptOrchestrator` in `packages/core`.
- Persist attempt metadata and artifacts.
- Wire command gates and review verdict into the step lifecycle.
- Add fix-step or replanning hook for failed reviews.
- Keep patch application to the main working tree approval-gated.

## Out Of Scope

- Full autonomous end-to-end coding.
- MCP server.
- Dashboard/TUI.
- A2A runtime.
- Direct writes to main branch without approval.
- Production external runner credentials.

## Tasks

- Implement runner input/output contracts from `docs/vision.md`.
- Execute a selected step attempt in an isolated worktree.
- Persist diff, logs, command outputs, gate results, review reports, and cost reports.
- Aggregate final run state.
- Add integration tests for a safe sample coding step.

## Acceptance Criteria

- A step can be attempted with auditable artifacts.
- Required gates run before a positive review verdict is accepted.
- `needs_changes` or `reject` creates a structured next action.
- No changes are applied to the main working tree automatically.
- Runner adapter failures produce structured attempt errors and artifact refs when available.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm test`
- `pnpm typecheck`
