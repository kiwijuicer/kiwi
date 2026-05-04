# Step 02: Contracts and Domain Schemas

Status: DONE
Done-Date: 2026-05-03
Milestone: MVP 1
Depends-On: Step 01
Vision-Refs: 4, 5, 6.1, 17.1

## Goal

Implement canonical domain contracts with Zod schemas and strict TypeScript types.

## Scope

- Define schemas and inferred types for:
  - `Initiative`
  - `Run`
  - `TaskGraph`
  - `Step`
  - `StepAttempt`
  - `Artifact`
  - `GateResult`
  - `ReviewVerdict`
- Define shared enums for roles, model capability tiers, statuses, artifacts, gates, budget, and risk.
- Document that backward compatibility is not required for Steps 01-14.
- Add serialization and validation tests.
- Export contracts from `packages/contracts`.

## Out Of Scope

- Persistence implementation.
- CLI commands.
- Provider or runner contracts beyond domain-level shapes.

## Tasks

- Create schema modules with schema and type side by side.
- Keep canonical terms aligned with `docs/vision.md`.
- Add fixture-based contract tests.
- Ensure invalid inputs fail with actionable validation errors.

## Acceptance Criteria

- All domain objects validate through exported Zod schemas.
- TypeScript consumers can import all domain types from `@kiwi/contracts`.
- Tests cover valid fixtures and representative invalid fixtures.
- No `any` is used at package boundaries.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/contracts test`
- `pnpm --filter @kiwi/contracts typecheck`
