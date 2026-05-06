# Step 30: Reviewer Cache Parity + Prompt Version Audit

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 13

## Goal

Match the planner's three-block prompt cache strategy in the reviewer
provider so long diffs reuse the cached prompt prefix on repeat calls.
Also surface the prompt version per phase in the audit log.

## Scope

- `packages/adapters/src/anthropic-reviewer-provider.ts` currently
  marks two `cache_control: ephemeral` blocks. Add a third cached
  block for the tool-schema reminder, mirroring
  `anthropic-planner-provider.ts:158-173`.
- For both planner and reviewer providers, emit a small audit event
  `prompt_version_used` with `phase`, `version`, `modelId` once per
  invocation. Add the type to
  `packages/core/src/cost-ledger.ts:AuditEventType`.
- Where parity is impossible (Claude Code CLI providers send a
  monolithic `--system-prompt`), document the limitation in
  `docs/architecture.md` so the audit reader knows why cache reuse is
  weaker via CLI mode.

## Out Of Scope

- Switching the CLI providers to a structured JSON system payload.

## Tasks

- Add the cached block.
- Emit `prompt_version_used`.
- Update `cost-ledger` event type list.
- Test: capture the request body and assert three cached blocks.

## Acceptance Criteria

- Reviewer transport spy receives a request with three
  `cache_control: ephemeral` system blocks.
- `audit.log` shows one `prompt_version_used` per planner call and one
  per reviewer call.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test` for adapter snapshot of the request body.
