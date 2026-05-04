# Step 17: Anthropic Reviewer Provider

Status: PROPOSED
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 16
Vision-Refs: 4.8, 5.3, 11.2, 11.3, 13

## Goal

Implement the first real reviewer provider behind the existing `ReviewEngine` boundary so that `ReviewVerdict` artifacts are produced from a real model against actual diff evidence.

## Scope

- Add `AnthropicReviewerProvider` in `packages/adapters`.
- Tier mapping at routing time:
  - `riskZones.high` step -> `claude-opus-4-6`
  - default -> `claude-sonnet-4-6`
- Review input is the produced `diff` artifact plus a compact context window: relevant `successCriteria`, last `gate-results.json`, and the focal `step` summary. Reviewer never receives the full repo.
- Versioned prompt template under `packages/adapters/src/prompts/reviewer/v1/`.
- Structured output validated against `ReviewVerdictSchema`. Schema-repair retry is bounded as in Step 16.
- Cost and token usage feed the existing cost ledger.
- Secret redaction reuses the helper introduced in Step 16.

## Out Of Scope

- Multi-pass review (e.g. security pass then style pass). Single structured pass is sufficient for V1.
- Inline comments mapped to file/line ranges in the diff. `issues[]` is sufficient.
- Bitbucket review comment posting. Step 22 demo uses PR draft only.

## Tasks

- Implement `AnthropicReviewerProvider` against `ReviewEngine` interfaces from Step 09.
- Wire diff-only review by reading `steps/<id>/<attempt>/artifacts/diff.patch` produced by Step 12.
- Implement risk-aware tier selection in `scheduler-policy.ts`.
- Add fixtures for `pass`, `pass_with_comments`, `needs_changes`, `reject`.
- Add bounded repair retry tests for invalid review JSON.
- Wire `recommendedNextSteps` into the existing replan/fix-step path from Step 12.

## Acceptance Criteria

- A real review call produces a `ReviewVerdict` validated against `ReviewVerdictSchema`.
- Reviewer input excludes full file content; tokens scale with diff size, not repo size.
- High-risk steps are reviewed by `claude-opus-4-6`; standard steps by `claude-sonnet-4-6`. Routing decision is recorded in the attempt metadata.
- `needs_changes` or `reject` produces a typed next action consumed by the orchestrator without manual intervention.
- `safeToApply` cannot become `true` unless a fresh review verdict references the current diff hash.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/adapters test`
- `pnpm --filter @kiwi/core test`
- `pnpm typecheck`
