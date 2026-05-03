# Step 14: A2A Preparation and Future Scale

Status: TODO
Done-Date: -
Milestone: MVP 5+
Depends-On: Step 13
Vision-Refs: 14.3, 17.5, 19

## Goal

Prepare future A2A and larger orchestration features only after internal contracts are stable.

## Scope

- Review stability of internal roles, contracts, runner boundaries, and review flows.
- Identify which internal APIs could become external protocol boundaries.
- Add compatibility and migration notes for future A2A.
- Define minimum requirements for dashboard/TUI or SaaS work if pursued.
- Keep future work explicitly gated behind completed CLI, runner, sandbox, and review foundations.
- Produce follow-up plan files only after this review identifies concrete implementation slices.

## Out Of Scope

- Implementing A2A runtime.
- Multi-tenant backend.
- Production dashboard.

## Tasks

- Audit current contract stability.
- Document externalization candidates and risks.
- Define non-breaking schema evolution strategy.
- Add conformance tests for serialization if needed.
- Create follow-up plans only for validated needs.

## Acceptance Criteria

- A2A is not started before core contracts are proven.
- Future protocol boundaries are documented.
- Schema evolution rules are explicit.
- No MVP scope is expanded retroactively.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm test`
- `pnpm typecheck`
