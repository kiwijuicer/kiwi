# Step 09: Quality Gates and Review Engine

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 3
Depends-On: Step 08
Vision-Refs: 4.7, 4.8, 11, 17.3

## Goal

Implement structured quality gate evidence and review verdicts before any automated code execution exists.

## Scope

- Add `QualityGates` primitives in `packages/core`.
- Add gate result persistence under each step attempt.
- Add `ReviewEngine` interfaces and structured JSON verdict validation.
- Add deterministic stub review implementation for tests.
- Support minimum gates:
  - typecheck
  - lint
  - relevant tests
  - forbidden file checks
  - secrets check
- Add feedback classification for `needs_changes` and `reject`.

## Out Of Scope

- Running commands in a sandbox.
- Applying diffs.
- Real reviewer provider calls.
- Full diff review execution against runner-produced patches.

## Tasks

- Implement gate result creation and validation.
- Implement review verdict validation and persistence.
- Add status aggregation for gate and review evidence.
- Add tests for pass, fail, blocked, and invalid review payloads.

## Acceptance Criteria

- Review output is structured JSON, not free text.
- Gate results reference evidence artifacts.
- Failed or blocked gates prevent safe continuation.
- Review verdicts can recommend replanning or fix steps.
- Review verdict fixtures validate against contracts.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/core test`
- `pnpm typecheck`
