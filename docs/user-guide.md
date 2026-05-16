# User Guide

## Mental Model

- CLI is the reference operator surface.
- MCP is the IDE/assistant access channel over the same core behavior.
- A2A is a gated handoff inbox. It is disabled by default and does not apply remote patches.

`kiwi` stores every run under:

```text
<workspace>/.kiwi/runs/<run-id>/
```

For a single repo, `<workspace>` is usually the repo root. For a multi-repo workspace like `/Users/norberthanauer/Projects/voice`, `<workspace>` is the parent workspace and `--repo` selects the target repo.

## Standard Flow

```bash
kiwi init --workspace /Users/norberthanauer/Projects/voice
kiwi workspace list --workspace /Users/norberthanauer/Projects/voice
kiwi plan ./ticket.md --workspace /Users/norberthanauer/Projects/voice --repo core
kiwi status <run-id> --workspace /Users/norberthanauer/Projects/voice
kiwi run <run-id> --workspace /Users/norberthanauer/Projects/voice
kiwi finalize <run-id> --workspace /Users/norberthanauer/Projects/voice
kiwi publish pr <run-id> --workspace /Users/norberthanauer/Projects/voice --remote origin --target-branch main
kiwi evidence manifest <run-id> --workspace /Users/norberthanauer/Projects/voice
kiwi operator snapshot <run-id> --workspace /Users/norberthanauer/Projects/voice
```

`kiwi plan` accepts either a file path or inline text:

```bash
kiwi plan "Fix missing consent state in handoff flow" --workspace /Users/norberthanauer/Projects/voice --repo livekit-agent
```

## Workspace Repos

`kiwi workspace list` reads `*.code-workspace` files and lists folders as repo candidates.

For the Voice workspace this means:

```text
core
livekit-agent
recorder
infrastructure
livekit-sip
trunk-manager
workspace
```

When running from inside a listed repo, `kiwi` selects that repo automatically. When running from the workspace root, pass `--repo`. The selector can be the listed id (`core`) or a folder path (`voice-core`).

## Assistant Interaction

All assistants use the same MCP server. The assistant can call:

- `kiwi_doctor` to inspect workspace, repo, policy, git state, execution mode, A2A, and local CLI readiness.
- `kiwi_plan` to create a run.
- `kiwi_status` to inspect runs.
- `kiwi_next` to get the exact next safe `recommendedToolCall`.
- `kiwi_preview_run` to inspect the decision card: step order, model switching, costs, gates, execution mode, mutation scope, confirmation summary, and `previewToken`.
- `kiwi_run` to execute all planned steps with a fresh `previewToken`.
- `kiwi_run_step` for advanced single-step execution with a fresh `previewToken`.
- `kiwi_diff` to inspect persisted diffs.
- `kiwi_cost` and `kiwi_explain` to inspect costs, routing, gates, and next action.
- `kiwi_finalize` to write final verdict and summary.
- `kiwi_publish_pr_draft` to push a local Bitbucket branch and write a PR draft artifact.
- `kiwi_evidence_manifest` to hash evidence and write an audit snapshot.
- `kiwi_operator_snapshot` to create a local HTML operator view.

Good assistant prompt:

```text
Use kiwi. Workspace: /Users/norberthanauer/Projects/voice. Repo: core.
Run kiwi_doctor, plan this ticket, call kiwi_next, show the preview decision summary, ask me to confirm, run the returned recommendedToolCall, finalize, and show me the evidence manifest path.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_next -> kiwi_preview_run -> user confirm decision.confirmationSummary -> decision.nextAction.recommendedToolCall -> kiwi_next -> finalize/evidence/snapshot
```

No direct Anthropic/OpenAI API key is required for the standard flow. Kiwi is Codex-first by default: each planned step is routed to a configured Codex CLI `providerModel`, passed with `--model`, and executed in the current repo working tree with `workspace-write`, `approval_policy="on-request"`, and `approvals_reviewer="auto_review"`. MCP `kiwi_run` and `kiwi_run_step` require a fresh `previewToken`; use `kiwi_next` whenever the correct next tool is unclear. Action-required errors include `data.recovery.recommendedToolCall`. Use `kiwi_request_approval`, not `approved`, for approval-required attempts. Set `KIWI_EXECUTION_ISOLATION=worktree` only when you explicitly want isolated worktree execution. Bitbucket PR publishing uses your existing git remote/auth to push a branch, then writes `final/pr-draft.json` and a Bitbucket create-PR URL.

## A2A

A2A is disabled by default. For trusted local filesystem exchange between two `kiwi` workspaces:

```bash
kiwi a2a enable --local-agent agent-a --workspace /path/to/workspace-a
kiwi a2a enable --local-agent agent-b --workspace /path/to/workspace-b
kiwi a2a trust add agent-b --inbox-path /path/to/workspace-b/.kiwi/a2a/transport/incoming --workspace /path/to/workspace-a
kiwi a2a trust add agent-a --inbox-path /path/to/workspace-a/.kiwi/a2a/transport/incoming --workspace /path/to/workspace-b
kiwi a2a publish task_graph --peer agent-b --run-id <run-id> --workspace /path/to/workspace-a
kiwi a2a sync --workspace /path/to/workspace-a
kiwi a2a sync --workspace /path/to/workspace-b
kiwi a2a inbox --workspace /path/to/workspace-b
```

Loopback validation is still available:

```bash
kiwi a2a receive ./a2a-envelope.json --loopback --trusted-agent remote-agent --workspace /path/to/workspace
```

Expected receive results:

- trusted envelope: `accepted`
- repeated idempotency key: `duplicate`
- missing trust or disabled runtime: `blocked`

Remote patch application remains blocked; patch and diff artifacts are quarantined until local apply gates exist.
