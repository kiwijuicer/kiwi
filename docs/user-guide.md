# User Guide

## Mental Model

- CLI is the reference operator surface.
- MCP is the IDE/assistant access channel over the same run store.
- Runs are local artifacts under `<workspace>/.kiwi/runs/<run-id>/`.
- Shared defaults live under `~/.kiwi/defaults/`.
- Workspace overrides can live under `<workspace>/.kiwi/policy.yaml` and `<workspace>/.kiwi/model-registry.yaml`.

For a single repo, `<workspace>` is usually the repo root. For a multi-repo
workspace, `<workspace>` is the parent control root and `--repo` selects the
target repo.

## First Setup

```bash
kiwi init --workspace <workspace>
kiwi models update --workspace <workspace> --apply
kiwi doctor --workspace <workspace>
```

Plain `kiwi init` creates home defaults, prepares workspace `.kiwi` state, and
writes Cursor, Claude Code, and Codex MCP project configs by default.
`kiwi models update --apply` refreshes `~/.kiwi/defaults/model-registry.yaml`
from the curated release catalog. Use `kiwi models list --json` to inspect the
effective registry.

Use:

- `--mcp none` to skip MCP config
- `--mcp cursor|claude|codex` to target one client
- `KIWI_HOME=<kiwi-home>` to use a non-default shared home

Generated Kiwi and MCP config paths are added to local ignore/exclude rules.

## Standard CLI Flow

```bash
kiwi workspace list --workspace <workspace>
kiwi models update --workspace <workspace> --apply
kiwi models list --workspace <workspace>
kiwi plan ./ticket.md --workspace <workspace> --repo api-service
kiwi status <run-id> --workspace <workspace>
kiwi explain <run-id> --workspace <workspace>
kiwi run <run-id> --workspace <workspace>
kiwi diff <run-id> --workspace <workspace>
kiwi finalize <run-id> --workspace <workspace>
kiwi cost <run-id> --workspace <workspace> --csv
kiwi evidence manifest <run-id> --workspace <workspace>
kiwi operator snapshot <run-id> --workspace <workspace>
```

`kiwi plan` accepts a file path or inline text:

```bash
kiwi plan "Fix missing consent state in handoff flow" --workspace <workspace> --repo api-service
```

Useful execution options:

```bash
kiwi run <run-id> --from-step step_003 --workspace <workspace>
kiwi run <run-id> --max-concurrency 2 --workspace <workspace>
kiwi run <run-id> --max-cost 1.00 --workspace <workspace>
kiwi run <run-id> --auto-fix --workspace <workspace>
kiwi run <run-id> --auto-replan --workspace <workspace>
```

`--command` is a controlled development override. Normal runs should use the
planned runner command.

## Workspace Repos

`kiwi workspace list` reads `*.code-workspace` files and lists folders as repo
candidates.

Example output:

```text
api-service
web-app
worker-service
infrastructure
```

When running from inside a listed repo, Kiwi selects that repo automatically.
When running from the workspace root, pass `--repo`. The selector can be the
listed id (`api-service`) or a folder path.

## Direct And Worktree Execution

Default execution isolation is direct mode:

- runs in the selected repo working tree
- captures a baseline before each StepAttempt
- persists generated diffs under the run
- blocks protected-looking branches, dirty tracked files, untracked non-Kiwi files, and non-git repos

Use isolated worktrees when you want source changes kept out of the selected repo
until an explicit apply step:

```bash
KIWI_EXECUTION_ISOLATION=worktree kiwi run <run-id> --workspace <workspace>
kiwi diff <run-id> --workspace <workspace>
kiwi apply <run-id> --workspace <workspace>
```

`kiwi apply --force-unsafe` exists for CLI use only when review verdicts block
the apply and the operator explicitly accepts that risk.

## Approvals

Policy may block an attempt when approval-required paths or command profiles are
hit.

CLI approval flow:

```bash
kiwi status <run-id> --workspace <workspace> --verbose
kiwi approve <run-id> <attempt-id> --approved-by <name> --reason "<reason>" --workspace <workspace>
kiwi run <run-id> --from-step <step-id> --workspace <workspace>
```

MCP approval uses `kiwi_request_approval` and requires `approvedBy`.
Set a default identity for MCP recommendations:

```bash
kiwi config set approver <name> --workspace <workspace>
```

`KIWI_MCP_APPROVED_BY=<name>` overrides workspace config for MCP servers.

## Recovery

If a process crashes while a mutating command owns a run lock, Kiwi can reclaim
dead owners automatically on the next lock acquisition. `kiwi doctor` also
reports stale locks:

```text
stale run locks: 1
  run_20260519_120000: run.lock
```

Manual recovery:

```bash
kiwi runs unlock <run-id> --workspace <workspace> --approved-by <name>
```

Use `--force` only after verifying a live owner process is no longer doing useful
work.

## Publishing PR Drafts

PR publishing is explicit:

```bash
kiwi publish pr <run-id> --workspace <workspace> --remote origin --target-branch main
```

Current behavior:

- pushes a local Bitbucket branch using existing git auth
- stages only expected diff files
- requires a clean target repo
- writes `final/pr-draft.json`
- prints a Bitbucket create-PR URL

## Assistant Interaction

All assistants use the same MCP server. Available tools:

- `kiwi_doctor`
- `kiwi_models_update`
- `kiwi_models_update_apply`
- `kiwi_plan`
- `kiwi_status`
- `kiwi_next`
- `kiwi_preview_run`
- `kiwi_run`
- `kiwi_run_step`
- `kiwi_diff`
- `kiwi_apply`
- `kiwi_cost`
- `kiwi_explain`
- `kiwi_request_approval`
- `kiwi_finalize`
- `kiwi_evidence_manifest`
- `kiwi_operator_snapshot`
- `kiwi_publish_pr_draft`

Good assistant prompt:

```text
Use kiwi. Workspace: <workspace>. Repo: api-service.
Run kiwi_doctor, plan this ticket, call kiwi_next, show the preview decision summary, ask me to confirm, run the returned recommendedToolCall, finalize, and show me the evidence manifest path.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_next -> kiwi_preview_run -> user confirm decision.confirmationSummary -> decision.nextAction.recommendedToolCall -> kiwi_next -> finalize/evidence/snapshot
```

MCP `kiwi_run`, `kiwi_run_step`, and `kiwi_apply` require a fresh
`previewToken`. The token is single-use and bound to run state, repo state,
policy, `fromStep`, `maxConcurrency`, and command override.

Use `kiwi_next` whenever the correct next tool is unclear. Action-required
errors include `data.recovery.recommendedToolCall`.

## Model And Auth Defaults

Model access uses local CLI authentication.

Default model access order:

1. Codex CLI with explicit `providerModel`
2. Claude Code CLI fallback
3. Cursor Agent CLI fallback
4. stub only when explicitly allowed

Curated Claude defaults:

| Capability | Claude Code model |
| --- | --- |
| `frontier` | `claude-opus-4-7` |
| `strong` | `claude-sonnet-4-6` |
| `mid` | `claude-haiku-4-5-20251001` |

Codex CLI catalog entries intentionally omit `providerModel` by default. Add a
workspace model-registry override once your local Codex CLI model names are
known.

Useful environment overrides:

- `KIWI_FORCE_ACCESS_MODE=<mode>`
- `KIWI_TEST_ALLOW_STUB=1 KIWI_FORCE_ACCESS_MODE=stub`
- `KIWI_EXECUTION_ISOLATION=worktree`
- `KIWI_HOME=<kiwi-home>`

## Future Agent Interop

Agent-to-agent handoff is not active scope. Any future interop channel needs a
new ADR, explicit contracts, and local gate semantics before implementation.
