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

- `kiwi_plan` to create a run.
- `kiwi_status` to inspect runs.
- `kiwi_run` to execute all planned steps.
- `kiwi_run_step` for advanced single-step execution.
- `kiwi_finalize` to write final verdict and summary.
- `kiwi_evidence_manifest` to hash evidence and write an audit snapshot.
- `kiwi_operator_snapshot` to create a local HTML operator view.

Good assistant prompt:

```text
Use kiwi. Workspace: /Users/norberthanauer/Projects/voice. Repo: core.
Plan this ticket, run the planned steps, then finalize and show me the evidence manifest path.
```

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
