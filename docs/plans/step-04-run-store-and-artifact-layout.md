# Step 04: Run Store and Artifact Layout

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 1
Depends-On: Step 03
Vision-Refs: 4.2, 4.6, 8, 17.1

## Goal

Implement canonical run persistence under `.kiwi/runs/<run-id>/`.

## Scope

- Add `packages/core` run store.
- Persist:
  - `run.json`
  - `initiative.json`
  - `plan/task-graph.json`
- Create reserved directories for later step, attempt, plan, and final artifacts.
- Add helpers for safe artifact paths.
- Add status aggregation primitives.
- Add tests for serialization and layout.

## Out Of Scope

- Actual planning logic.
- Provider integration.
- Provider-specific `planner-input.json` and `planner-output.json` writes.
- Step execution.
- Review engine.

## Tasks

- Implement run directory creation.
- Validate all written JSON through contracts.
- Add atomic or safe write behavior for run artifacts.
- Add deterministic ID/time injection for tests.
- Add read APIs for later status and review flows.
- Add path traversal protection for artifact reads and writes.

## Acceptance Criteria

- Run folders match the layout documented in `docs/vision.md`.
- No single-file `.kiwi/runs/<id>.json` end state exists.
- Invalid run artifacts are rejected on read.
- Tests can create reproducible run artifacts.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/core test`
- `pnpm --filter @ai-kiwi/core typecheck`
