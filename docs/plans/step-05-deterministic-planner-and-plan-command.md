# Step 05: Deterministic Planner and Plan Command

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 1
Depends-On: Step 04
Vision-Refs: 4.1, 4.3, 4.4, 17.1

## Goal

Implement MVP1 planning: turn a ticket into a reproducible `TaskGraph` and persisted run artifacts.

## Scope

- Add deterministic planner in `packages/core`.
- Implement `kiwi plan <ticket>`.
- Support inline ticket text and stable file-path input.
- Persist `run.json`, `initiative.json`, and `plan/task-graph.json`.
- Keep planner output deterministic and provider-free.
- Add tests for contracts, core planner, and CLI command behavior.

## Out Of Scope

- LLM provider calls.
- Retry behavior.
- Cost accounting beyond placeholder fields needed by contracts.
- Step execution.

## Tasks

- Create `Initiative` from CLI input.
- Generate a deterministic `TaskGraph` with canonical `Step` objects.
- Set `agentRole` separately from `modelCapability`.
- Persist generated artifacts through the run store.
- Add readable CLI output with the run id and artifact path.

## Acceptance Criteria

- `kiwi plan <ticket>` creates a valid run folder.
- All generated files validate against `@kiwi/contracts`.
- Planning is reproducible in tests via injected ID/time providers.
- Generated steps include success criteria and required gates.
- Generated TaskGraphs include assumptions, open questions, risk score, and complexity score.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/core test`
- `pnpm --filter @kiwi/cli test`
- `pnpm typecheck`
