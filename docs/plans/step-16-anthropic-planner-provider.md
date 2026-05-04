# Step 16: Anthropic Planner Provider

Status: PROPOSED
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 15
Vision-Refs: 5.3, 6.1, 9, 10, 13, 17.2

## Goal

Implement the first real planner provider behind the existing `PlannerProvider` contract, replacing the stub for default planning while keeping the stub as a test fixture.

## Scope

- Add `AnthropicPlannerProvider` in `packages/adapters` that targets `claude-opus-4-6` for planning.
- Versioned prompt template stored under `packages/adapters/src/prompts/planner/v1/` (system prompt, user envelope, tool schemas).
- Structured output: response is parsed and validated against `TaskGraphSchema` from `@kiwi/contracts`.
- Schema-repair retry: on invalid output, send a constrained repair turn including the original output and validation errors. Max repair attempts is configurable, default 1.
- Token and cost extraction from `usage` in provider response. Cost feeds the existing cost ledger; no zero-cost shortcut.
- Prompt caching: system prompt, tool/schema block, and repo skeleton block are sent with `cache_control` so subsequent attempts amortize cost.
- Secret redaction on prompt construction: any value in `kiwi-policy.yaml` `secretEnvNames` or detected in the input is replaced with `[REDACTED]` before send.
- Typed provider errors: rate-limit, timeout, network, schema-invalid, content-policy. Each maps to an existing scheduler error class.

## Out Of Scope

- Reviewer provider (Step 17).
- Runner adapter changes (Step 18).
- Streaming. Single-shot completion is sufficient for V1.
- Multi-provider fallback or failover.

## Tasks

- Implement `AnthropicPlannerProvider` against `PlannerProvider`.
- Implement prompt-versioning helper in `packages/adapters/src/prompts/`.
- Implement schema-repair retry wrapper. Reuse existing retry primitive from Step 08 if compatible.
- Wire real cost into `cost-ledger.ts`. Stub providers continue to emit zero-cost.
- Add provider selection to `kiwi-policy.yaml` and `apps/cli/src/commands/init.ts` defaults.
- Add unit tests against recorded fixtures (no live calls in CI). Add one opt-in live smoke behind `KIWI_LIVE_PROVIDER=1`.

## Acceptance Criteria

- A real planner call produces a `TaskGraph` that validates against `TaskGraphSchema`.
- Invalid initial output triggers a bounded repair attempt and is retried at most once before failing as `provider_schema_invalid`.
- `planner-input.json` and `planner-output.json` contain redacted prompts and the unmodified validated TaskGraph.
- `cost-report.json` reflects real input/output tokens and USD estimate from provider usage.
- Prompts and logs contain no raw secret material from `secretEnvNames`.
- `core` has no Anthropic SDK import. Only `packages/adapters` imports the SDK.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/adapters test`
- `pnpm --filter @kiwi/core test`
- `pnpm typecheck`
- Optional: `KIWI_LIVE_PROVIDER=1 pnpm --filter @kiwi/adapters test:live`
