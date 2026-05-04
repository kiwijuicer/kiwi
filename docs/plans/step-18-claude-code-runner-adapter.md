# Step 18: Claude Code Runner Adapter

Status: DONE
Done-Date: 2026-05-04
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 16
Vision-Refs: 7.1, 7.2, 8, 11.1, 12

> Implementation note: `ClaudeCodeRunnerAdapter` lives in
> `packages/adapters/src/claude-code-cli/runner-adapter.ts` and shares the
> CLI client with the Claude Code planner/reviewer providers. The runtime
> picks it via `resolveRunner` based on the step type (coding steps prefer
> `claude-code` when the binary is available; other step types prefer
> `local-shell`).

## Goal

Implement the first real coding runner behind the existing `RunnerAdapter` contract by wrapping the Claude Code CLI as a subprocess that operates inside the per-attempt sandbox worktree.

## Scope

- Add `ClaudeCodeRunnerAdapter` in `packages/adapters` with `name: "claude-code"`.
- Spawn `claude` (or configured binary) inside the attempt worktree only. Inherit the sandbox env allowlist and timeout.
- Construct the runner prompt envelope from `RunnerExecutionInput.contextPackage`, `stepPrompt`, `successCriteria`, `allowedTools`, and the focal `worktreePath`.
- Capture subprocess stdout/stderr as raw log artifact. Capture model usage from CLI structured output if available; otherwise leave `modelUsage` zero-filled with a `usage_unknown` flag.
- After the subprocess exits, normalize the result using existing `captureWorktreeDiffArtifact` to produce a `diff` artifact. The runner does not emit its own ad-hoc patch format.
- Map exit conditions to typed `RunnerExecutionOutput.status`:
  - clean exit + non-empty diff -> `completed`
  - clean exit + empty diff -> `completed` with a `no_change` artifact note
  - non-zero exit -> `failed`
  - sandbox-blocked command during run -> `blocked`
  - timeout -> `failed` with `RUNNER_TIMEOUT`
- Honor `commandPolicy.networkPolicy` and `approvalRequiredPaths`. The runner never bypasses the sandbox layer; subcommands it spawns must pass the same gates.

## Out Of Scope

- Codex adapter, generic API adapter, or remote-runner wiring.
- Streaming UI or progress visualization.
- A2A delegation of step execution.
- Auto-apply to main working tree.

## Tasks

- Implement subprocess wrapper with stdin/stdout/stderr handling and timeout integration with existing sandbox primitives.
- Implement prompt envelope serialization in `packages/adapters/src/runners/claude-code/`.
- Implement result normalizer that produces `diff`, `command_output`, and optional `cost_report` artifacts.
- Add denied-path enforcement against the resulting diff (defense-in-depth on top of command-level checks).
- Add tests with a mocked `claude` binary that emits canned output for `completed`, `failed`, `blocked`, `timeout`, `no_change` cases.
- Add an opt-in live smoke behind `KIWI_LIVE_RUNNER=1`.

## Acceptance Criteria

- A coding step can be executed via `ClaudeCodeRunnerAdapter` and produces a `diff` artifact in the run store.
- Adapter never writes outside the attempt worktree.
- Sandbox-blocked subcommands trigger an `approval_required` or `blocked` runner status with a `GateResult` artifact.
- Timeouts kill the subprocess tree and leave no orphaned children.
- Empty diffs produce a clean `completed` outcome marked `no_change`, not a fake patch.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/adapters test`
- `pnpm --filter @kiwi/sandbox test`
- `pnpm --filter @kiwi/core test`
- `pnpm typecheck`
- Optional: `KIWI_LIVE_RUNNER=1 pnpm --filter @kiwi/adapters test:live`
