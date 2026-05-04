# Step 10: Scheduler Policy and Context Packaging

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 3
Depends-On: Step 09
Vision-Refs: 9, 10, 12, 13, 17.3

## Goal

Implement policy-based scheduling decisions and persisted context packages for step attempts.

## Scope

- Add scheduler policy engine in `packages/core`.
- Route in two stages:
  - choose `agentRole`
  - choose `modelCapability`
- Select runner, context level, gates, and review depth.
- Implement context package levels `L0` through `L3`.
- Persist `context-package.json` for scheduled step attempts when an attempt record is created.

## Out Of Scope

- Actual runner execution.
- Real model calls.
- Full historical run learning.
- Worktree lifecycle.

## Tasks

- Encode risk, blast radius, security sensitivity, context size, budget, and availability inputs.
- Enforce risk override rules.
- Implement context pack builders with explicit file selection.
- Add tests for low-risk, high-risk, budget-constrained, and blocked scenarios.
- Add audit records for routing decisions and policy outcomes.

## Acceptance Criteria

- Scheduler decisions are serializable and auditable.
- `risk > budget` is enforced.
- High-risk zones require stronger execution/review metadata.
- Context packaging never blindly includes the full repo.
- Scheduler output separates `agentRole` from `modelCapability`.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/core test`
- `pnpm typecheck`
