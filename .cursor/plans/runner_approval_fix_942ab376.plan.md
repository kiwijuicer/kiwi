---
name: runner approval fix
overview: Stop hidden approval/MCP hangs in external CLI runners by making all runner invocations explicitly non-interactive, preventing recursive Kiwi MCP startup, and adding live runner logs while processes are still running.
todos:
  - id: stabilize-run
    content: Confirm and safely stop the current hidden child runner if still active
    status: pending
  - id: runner-env-guard
    content: Inject KIWI_RUNNER_ACTIVE into external runner environments and test filtering
    status: pending
  - id: mcp-reentrancy-guard
    content: Block Kiwi MCP stdio startup inside runner child processes
    status: pending
  - id: cli-flags
    content: Add non-interactive flags for Claude, Codex, and Cursor CLI clients
    status: pending
  - id: live-logs
    content: Wire streaming logs into external execution runner adapters
    status: pending
  - id: focused-tests
    content: Update and run focused adapter and MCP tests
    status: pending
isProject: false
---

# Hidden Runner Approval Fix

## Problem To Address

The current run is stuck after `step_attempt_started`: the parent Kiwi MCP server holds `run.lock`, while a child `claude -p ... --output-format json` process runs without a TTY or stdin. Claude also spawned another Kiwi MCP server from workspace MCP config, so any hidden MCP/tool approval cannot be answered and no runner log is persisted until the child exits.

Relevant code paths:
- [`packages/adapters/src/integrations/claude-code/client.ts`](packages/adapters/src/integrations/claude-code/client.ts): builds the `claude -p` args.
- [`packages/adapters/src/integrations/claude-code/runner-adapter.ts`](packages/adapters/src/integrations/claude-code/runner-adapter.ts): execution runner that hung.
- [`packages/adapters/src/integrations/codex/client.ts`](packages/adapters/src/integrations/codex/client.ts): current Codex defaults still allow request-style approvals.
- [`packages/adapters/src/integrations/cursor-agent/client.ts`](packages/adapters/src/integrations/cursor-agent/client.ts): headless Cursor runner can also hit trust/MCP/command prompts.
- [`packages/adapters/src/runners/env.ts`](packages/adapters/src/runners/env.ts): runner env filtering currently does not set a Kiwi reentrancy sentinel.
- [`apps/mcp-server/src/server/bootstrap.ts`](apps/mcp-server/src/server/bootstrap.ts): MCP server starts even when spawned from inside a Kiwi runner.
- [`packages/adapters/src/runners/logs.ts`](packages/adapters/src/runners/logs.ts): streaming log support exists but the external runner adapters do not use it.

## Implementation Plan

1. Stabilize the current stuck run before editing:
- Re-check the active PIDs and artifact state.
- If the same child runner is still hung, terminate only the child `claude` process tree, not the parent Cursor/Kiwi MCP server.
- Wait for Kiwi to record timeout/failure and release the lock. If the parent process is gone but `run.lock` remains, treat it as a stale lock and handle it explicitly, with evidence.

2. Add a shared non-interactive runner environment guard:
- Extend [`packages/adapters/src/runners/env.ts`](packages/adapters/src/runners/env.ts) to inject an internal sentinel such as `KIWI_RUNNER_ACTIVE=1` into all external runner processes after allowlist filtering.
- Preserve the existing safe env behavior for user secrets.
- Add tests proving `SECRET_TOKEN` stays filtered while the Kiwi sentinel is always present.

3. Block recursive Kiwi MCP startup inside runner children:
- Update [`apps/mcp-server/src/server/bootstrap.ts`](apps/mcp-server/src/server/bootstrap.ts) so stdio startup refuses to run when `KIWI_RUNNER_ACTIVE=1` is present.
- Return a clear stderr/debug message like `kiwi MCP disabled inside kiwi runner process` and exit fast instead of waiting on stdin or contending for a run lock.
- Keep normal Cursor/Claude/Codex MCP startup unchanged outside runner children.
- Add MCP bootstrap tests covering normal startup and guarded startup.

4. Make Claude Code CLI invocations non-interactive by construction:
- In [`packages/adapters/src/integrations/claude-code/client.ts`](packages/adapters/src/integrations/claude-code/client.ts), centralize/export the arg builder and add defaults for all `claude -p` calls:
  - `--permission-mode dontAsk` so permission requests fail instead of blocking invisibly.
  - `--strict-mcp-config --mcp-config {"mcpServers":{}}` so Claude does not auto-load workspace `.mcp.json` and recursively spawn Kiwi MCP.
  - `--no-session-persistence` to avoid hidden session resume state in scripted runs.
- Keep explicit `--allowedTools Read,Write,Edit` for the execution runner.
- Do not use `--dangerously-skip-permissions` by default.

5. Make Codex CLI invocations fail-closed instead of requesting approval:
- In [`packages/adapters/src/integrations/codex/client.ts`](packages/adapters/src/integrations/codex/client.ts), change scripted defaults from approval-on-request to no interactive approval requests.
- Add `--ignore-user-config` to avoid workspace/user config side effects such as extra MCP/tool hooks, while preserving auth behavior.
- Keep `--sandbox workspace-write`, `--ephemeral`, and JSON output.
- Update planner/reviewer/researcher tests that currently assert `approvalPolicy === "on-request"`.

6. Make Cursor Agent CLI headless runs explicit:
- In [`packages/adapters/src/integrations/cursor-agent/client.ts`](packages/adapters/src/integrations/cursor-agent/client.ts), centralize/export the arg builder and add headless flags:
  - `--trust` to avoid workspace trust prompts.
  - `--force` to avoid hidden command/tool approval prompts.
  - `--sandbox enabled` to keep command execution constrained where Cursor supports it.
  - `--workspace <cwd>` so workspace selection is deterministic.
  - `--approve-mcps` only with the Kiwi MCP reentrancy guard in place, so MCP-server approval cannot hang and recursive Kiwi startup exits immediately.
- Keep JSON output for all provider and runner invocations.

7. Persist live output for external execution runners:
- In [`packages/adapters/src/integrations/claude-code/runner-adapter.ts`](packages/adapters/src/integrations/claude-code/runner-adapter.ts), [`packages/adapters/src/integrations/codex/runner-adapter.ts`](packages/adapters/src/integrations/codex/runner-adapter.ts), and [`packages/adapters/src/integrations/cursor-agent/runner-adapter.ts`](packages/adapters/src/integrations/cursor-agent/runner-adapter.ts), open a streaming log with `openStreamingRunnerLog()` before launching the subprocess.
- Pass `onOutputChunk` into the CLI invocation and close the stream in `finally`.
- Pass `liveLogPath` through `cliRunnerOutput()` so operator surfaces can show/tail the current stream before process completion.
- Keep the final consolidated `*-runner-logs.json` artifact unchanged.

8. Add focused tests:
- Adapter client arg tests for Claude, Codex, and Cursor verifying the non-interactive flags.
- Runner adapter tests verifying `liveLogPath` is populated and the stream file contains redacted output when fake runners emit chunks.
- Env tests for `KIWI_RUNNER_ACTIVE` plus secret filtering.
- MCP bootstrap test for guarded nested startup.
- Update existing expectations in [`packages/adapters/src/__tests__/runners/runner-adapter.test.ts`](packages/adapters/src/__tests__/runners/runner-adapter.test.ts), [`packages/adapters/src/__tests__/providers/cli-role-providers.test.ts`](packages/adapters/src/__tests__/providers/cli-role-providers.test.ts), and Claude planner tests as needed.

## Validation

Run focused checks only:
- `pnpm --filter @kiwi/adapters test -- runner-adapter cli-role-providers claude-code-cli-planner runner-logs-streaming`
- `pnpm --filter @kiwi/mcp-server test -- services mcp`
- `pnpm --filter @kiwi/adapters typecheck`
- `pnpm --filter @kiwi/mcp-server typecheck`
- `pnpm lint` only if the touched files introduce lint findings or package-level checks pass but repo lint is required before merge.

## Expected Outcome

External CLI runners either proceed without hidden prompts or fail quickly with persisted evidence. Claude no longer loads workspace MCP config during runner execution, recursive Kiwi MCP startup is blocked for all runner children, and long-running attempts expose live logs before completion.