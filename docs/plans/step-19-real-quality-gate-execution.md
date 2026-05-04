# Step 19: Real Quality Gate Execution

Status: PROPOSED
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 12
Vision-Refs: 11.1, 11.2, 12, 13

## Goal

Replace placeholder gate evidence with real typecheck, lint, test, forbidden-file, and secrets-check executions inside the per-attempt sandbox, and make `safeToApply` strictly evidence-driven.

## Scope

- Add gate command profiles under `kiwi-policy.yaml`:
  - `typecheck` -> `pnpm typecheck`
  - `lint` -> root `pnpm lint` (eslint baseline + biome) once it is non-placeholder
  - `tests` -> `pnpm test` filtered to changed packages where possible
  - `forbidden_file_checks` -> path-pattern check against `riskZones`
  - `secrets_check` -> regex/entropy scan over the diff and command outputs
- Each gate runs through the existing sandbox layer. No gate runs outside the sandbox.
- Each gate persists a structured artifact:
  - `typecheck_report.json`
  - `lint_report.json`
  - `test_report.json`
  - `forbidden_file_report.json`
  - `secrets_report.json`
- Gate aggregation lives in `packages/core/src/quality-gates.ts`. Aggregator records `evidenceRefs` per gate and records the diff hash that the gates verified.
- `safeToApply` becomes a function of: every required gate has a `pass` `GateResult`, the verified diff hash matches the current attempt diff hash, and the `ReviewVerdict` consumed that same hash.

## Out Of Scope

- Full secret scanner replacement; a simple regex+entropy pass is sufficient for V1.
- Selective test impact analysis beyond changed-package detection.
- Mutation testing or coverage gates.

## Tasks

- Replace root `pnpm lint` placeholder with a real configuration that succeeds on a clean tree (refer to existing `eslint.config.mjs` and `biome.json`).
- Wire each gate to the sandbox via `executeSandboxCommand` with the appropriate `gateType`.
- Implement structured report parsers (TS compiler diagnostics JSON, eslint JSON, vitest JSON reporter).
- Implement diff-hash verification in the aggregator and persist it next to each gate result.
- Add tests for each gate: `pass`, `fail`, `blocked` (when policy denies the command), and `stale` (diff hash mismatch).

## Acceptance Criteria

- `safeToApply` is `false` whenever any required gate is missing, blocked, failed, or evidences a different diff hash than the current attempt.
- Gate reports are persisted as structured JSON, not free text.
- Lint is no longer a placeholder; running `pnpm lint` on a clean tree exits zero.
- A failing gate prevents `kiwi finalize` from succeeding without explicit operator override and audit entry.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/core test`
- `pnpm --filter @kiwi/sandbox test`
- `pnpm lint`
- `pnpm typecheck`
