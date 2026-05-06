# Step 28: Capability-driven Context Shrink

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 10, 13

## Goal

Honor the documented promise that `cheap` and `mid` operate on a
smaller context than `strong`/`frontier`. Today
`determineContextLevel` only varies on `contextSize` and `risk`.

## Scope

- In `packages/runtime/src/scheduler-policy.ts:determineContextLevel`:
  cap the level at `L0` when the resolved capability is `cheap`, and
  at `L1` for `mid`, unless `riskHigh` overrides (already covered).
- Pass the `modelCapability` into `determineContextLevel`. The function
  is currently called before the capability is decided; reorder
  `prepareScheduling` so capability is computed first, then used as
  input to context-level decision.
- Append `cheap_capability_l0_cap` / `mid_capability_l1_cap` to
  `routingReason` whenever the cap shrinks the level.
- Update `docs/architecture.md` table to make the capability-vs-level
  rule explicit.

## Out Of Scope

- Token-aware context compression. Out of scope until step 38 (richer
  planner context) lands.

## Tasks

- Refactor `prepareScheduling` for the new ordering.
- Extend `determineContextLevel` signature.
- Add a Vitest fixture asserting `cheap` -> `L0` and `mid` -> `L1`
  outside risk-high steps.
- Update `docs/architecture.md`.

## Acceptance Criteria

- Schedule with `cheap` capability emits `contextLevel: L0`.
- Schedule with `frontier` and `large` context still emits `L2` (or
  `L3` under risk-high).
- `routingReason` mentions the cap when applied.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
