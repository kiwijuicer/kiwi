# Step 26: Canonical ContextPackage in Contracts

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: Step 24
Vision-Refs: 4.6, 6.1, 10

## Goal

Stop shadowing canonical contracts: drive `ContextPackage`,
`ContextLevel`, `BlastRadius`, `SecuritySensitivity`, `ContextSize`
and `SchedulerDecision` from `@kiwi/contracts` instead of redeclaring
them in `packages/runtime/src/scheduler-types.ts`.

## Scope

- `BlastRadius`, `SecuritySensitivity`, `ContextSize` are runtime-only
  classifiers; keep them in `scheduler-types.ts` but as `as const`
  unions to match the `@kiwi/contracts` style.
- `ContextLevel` and `ContextPackage` already exist as Zod schemas in
  `packages/contracts/src/execution.ts` (`ContextLevelSchema`,
  `ContextPackageSchema`). Replace the local TS interface with a
  type derived from the schema (`z.infer<typeof ContextPackageSchema>`)
  and update consumers.
- `SchedulerDecision` likewise: re-export the type from
  `@kiwi/contracts` (`SchedulerDecisionSchema`), drop the manual
  interface in `scheduler-types.ts`.
- Update imports in `packages/runtime/src/scheduler-policy.ts`,
  `packages/runtime/src/step-attempt-orchestrator.ts`,
  `packages/runtime/src/planned-step-execution.ts`,
  `packages/runtime/src/step-attempt/runner.ts`.

## Out Of Scope

- Schema additions (`subPlans`, parallel scheduling fields). Those are
  step 35 / 36.

## Tasks

- Identify which `scheduler-types.ts` types map 1:1 onto contracts.
- Replace duplicates with `z.infer` types or direct re-exports.
- Run typecheck + arch lint.

## Acceptance Criteria

- `packages/runtime/src/scheduler-types.ts` is < 30 lines and only
  contains runtime-internal classifiers (`BlastRadius`,
  `SecuritySensitivity`, `ContextSize`, `SchedulerDecisionStatus`).
- All `ContextPackage` and `SchedulerDecision` uses come from
  `@kiwi/contracts`.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:arch && pnpm lint:baseline`.
