# Step 11: Worktree Sandbox and Command Execution

Status: TODO
Done-Date: -
Milestone: MVP 4
Depends-On: Step 10
Vision-Refs: 7.2, 8, 12, 17.4

## Goal

Add isolated worktree sandboxing and controlled command execution for step attempts.

## Scope

- Implement `packages/sandbox`.
- Create per-run or per-attempt worktrees.
- Enforce command allowlists by step type.
- Enforce path denylist and approval-required zones.
- Apply environment allowlist, secret redaction, timeouts, and process limits.
- Enforce per-attempt network policy.
- Persist command output artifacts and audit events.

## Out Of Scope

- Provider-specific runner adapters.
- Automatic application of changes to the main working tree.
- Production credential access.

## Tasks

- Add worktree lifecycle management.
- Add command execution API with typed inputs and outputs.
- Add policy checks before execution.
- Add secret redaction for logs and artifacts.
- Add tests for allowed, blocked, timeout, and denied-path scenarios.
- Model approval states as `auto`, `required`, or `blocked`.

## Acceptance Criteria

- Runner commands never write directly to the main working tree.
- Blocked commands produce explicit `GateResult` or execution failure evidence.
- Logs do not contain raw secret material.
- Sandboxed command outputs are persisted as artifacts.
- Approval-required commands do not run without explicit approval state.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/sandbox test`
- `pnpm typecheck`
