# Step 33: Live `kiwi tail` + Streaming Output

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 14.1

## Goal

Make long-running runs observable. Today `kiwi run` blocks until the
loop ends and the CLI providers buffer stdout.

## Scope

- New CLI command: `kiwi tail <runId>` in
  `apps/cli/src/commands/tail.ts`. Tail
  `.kiwi/logs/audit.log`, filter by `runId`, pretty-print phase /
  event / payload summary. Optional `--phase`, `--since`, `--no-color`.
- Register through
  `apps/cli/src/commands/register-core.ts` and the MCP server
  resource list (read-only resource).
- `packages/adapters/src/claude-code-cli/client.ts` currently
  buffers stdout. Add an optional `onChunk(chunk: string)` callback
  to the runner contract; when set, forward partial JSONL/text to a
  consumer. Wire it through
  `step-attempt-orchestrator.ts` so that, when running interactively
  (`process.stdout.isTTY`), `kiwi run` echoes a one-line event per
  chunk in dim chalk.
- Match for the codex and cursor-agent clients: same callback;
  no-op default keeps current behaviour.

## Out Of Scope

- Full TUI/dashboard. This is a streaming log + tail command, not a UI.

## Tasks

- Implement `kiwi tail`.
- Add `onChunk` to `ClaudeCodeCliRunner`, `CodexCliRunner`,
  `CursorAgentCliRunner`.
- Wire into orchestrator with TTY guard.
- Smoke fixture: assert that running a long stub command prints
  intermediate events to stdout when `KIWI_TAIL_TTY=1` is forced.

## Acceptance Criteria

- `kiwi tail <runId>` prints events as they are appended.
- `kiwi run` shows live progress lines on a TTY without blocking the
  audit log.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test` for the CLI tail behaviour.
