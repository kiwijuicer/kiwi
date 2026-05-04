# Step 20: Git Worktree Sandbox Hardening

Status: PROPOSED
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 11
Vision-Refs: 7.2, 8, 12

## Goal

Replace the copy-folder isolation in `packages/sandbox` with real `git worktree` lifecycles, and enforce denied paths against the resulting diff in addition to command arguments.

## Scope

- Add `createGitWorktreeSandbox` next to existing `createWorktreeSandbox`. New runs use git worktree by default; copy-folder remains only for non-git workspaces and is explicitly opt-in.
- Worktree path stays under `.kiwi/runs/<run-id>/worktrees/<attempt-id>/`.
- Use `git worktree add --detach` from the selected repo, so the attempt has a real git environment with full history available read-only.
- Diff capture switches from manual file enumeration to `git diff` between the worktree's `HEAD` and the working tree, persisted as `diff.patch`. Existing `captureWorktreeDiffArtifact` becomes a fallback for non-git roots.
- Worktree teardown:
  - On attempt completion: `git worktree remove --force` plus a verification that the path no longer exists.
  - On crash recovery: `kiwi init` and `kiwi run` startup invoke an orphan reaper that lists `git worktree list` and prunes attempt worktrees not present in the run store.
- Denied-path enforcement is added at two layers:
  - Command-time check (existing) on argument paths.
  - Diff-time check after the runner produces a patch: any modified path matching `riskZones` or `deniedPaths` blocks finalize and produces a `forbidden_file_report.json` with `status: blocked`.
- Process-tree cleanup: subprocess kill on timeout uses `tree-kill` semantics so children are reaped.

## Out Of Scope

- Container-based isolation (Docker, Firecracker). Out of milestone.
- Cross-repo worktrees in multi-repo workspaces. The selected repo is the worktree root.
- Network namespace isolation beyond the existing `networkPolicy` allowlist.

## Tasks

- Implement `createGitWorktreeSandbox` and the orphan reaper in `packages/sandbox`.
- Switch `LocalShellRunnerAdapter` and `ClaudeCodeRunnerAdapter` (Step 18) to consume the new worktree where available.
- Replace the existing copy-folder code path with a fallback used only when the source path is not a git repo.
- Add diff-time denied-path enforcement to the gate aggregator from Step 19.
- Update the audit log event vocabulary to include `worktree_created`, `worktree_removed`, `worktree_orphan_reaped`, `diff_path_blocked`.
- Add tests:
  - happy path create/remove
  - crash recovery reaping
  - denied path enforced via diff
  - timeout kills child process tree

## Acceptance Criteria

- Default worktree mode is `git worktree`. Copy-folder is fallback-only and clearly logged when used.
- An attempt that modifies a `riskZones.high` path is blocked at finalize with explicit evidence, even if the runner produced a clean diff and review.
- No orphaned worktrees after a forced kill; orphan reaper restores a clean state on next CLI invocation.
- Process-tree cleanup is verified by tests; no zombie children remain after a sandbox timeout.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/sandbox test`
- `pnpm --filter @kiwi/core test`
- `pnpm typecheck`
- `pnpm test`
