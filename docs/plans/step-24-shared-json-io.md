# Step 24: Centralize JSON IO + Helpers

Status: COMPLETED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 6.1, 6.2

## Goal

Eliminate `writeJsonSafely`, `inferAccessMode` and `tryParseJson`
duplication. Single source of truth per helper.

## Scope

- Create `packages/core/src/storage/json-io.ts` exporting
  `writeJsonSafely`, `readJsonOrThrow`, `appendJsonLine`. Re-export
  through `packages/core/src/index.ts`.
- Replace the eight in-line `writeJsonSafely` definitions in:
  `packages/core/src/run-store.ts`,
  `packages/core/src/cost-ledger.ts`,
  `packages/core/src/model-invocations.ts`,
  `packages/runtime/src/quality-gates.ts`,
  `packages/runtime/src/scheduler-policy.ts`,
  `packages/runtime/src/step-attempt-artifacts.ts`,
  `packages/runtime/src/review-engine.ts`,
  `packages/runtime/src/lifecycle/finalize.ts`.
- Move `inferAccessMode` once into
  `packages/core/src/model-invocations.ts` (or
  `packages/runtime/src/access-mode-resolver.ts` if dependency
  direction prefers it). Delete the duplicate in
  `packages/ops/src/run-summary.ts` and import the single version.
- Move `tryParseJson` to a shared `packages/adapters/src/json-utils.ts`
  and replace usage in
  `packages/adapters/src/anthropic-common.ts:extractTextJson` (already
  generic), `packages/adapters/src/claude-code-cli/client.ts`,
  `packages/adapters/src/claude-code-cli/planner-provider.ts`,
  `packages/adapters/src/claude-code-cli/reviewer-provider.ts`,
  `packages/adapters/src/cursor-agent-cli/client.ts`. If
  `extractTextJson` already does the job, prefer reusing it and drop
  the file-local copies.

## Out Of Scope

- Rearranging tests; keep them green via imports only.
- Touching the redaction or audit helpers.

## Tasks

- Add `packages/core/src/storage/json-io.ts` with three small
  functions; one canonical implementation pattern.
- Re-wire imports.
- Run `pnpm typecheck`, `pnpm lint:eslint`, `pnpm lint:arch`,
  `pnpm lint:file-size`. Run `pnpm test` locally.

## Acceptance Criteria

- `grep -rn "function writeJsonSafely" packages/` returns exactly one
  match.
- `grep -rn "function inferAccessMode" packages/` returns exactly one
  match.
- `grep -rn "function tryParseJson" packages/adapters/src` returns
  exactly one match (or zero if `extractTextJson` already covers all
  callers).
- All gates listed above pass.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline && pnpm lint:arch && pnpm lint:file-size && pnpm lint:a2a-freeze`.
- `pnpm test` on the developer machine.
