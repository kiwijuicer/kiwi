# ai-kiwi MCP Server

Thin MCP access channel over `packages/core`.

The CLI remains the reference operator surface. MCP clients use the same run store, policy, locks, evidence, and audit artifacts.

## Start

```bash
pnpm build
AI_KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  node /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js
```

For single-repo use, set `AI_KIWI_WORKSPACE` to the repo root or omit it when the client starts the server from the repo root.

## Tool API

Core tools:

- `kiwi_plan`: create a planned run.
- `kiwi_status`: read run status.
- `kiwi_run`: execute planned steps in order.
- `kiwi_run_step`: execute one planned step.
- `kiwi_finalize`: write final verdict, summary, and cost report.
- `kiwi_evidence_manifest`: write hashed evidence manifest and audit snapshot.
- `kiwi_operator_snapshot`: write local operator HTML snapshot.

Additional tools:

- `kiwi_request_approval`: record an approval decision.
- `kiwi_a2a_receive`: validate and optionally accept a gated loopback A2A envelope.
- `kiwi_a2a_config`: read or update local A2A identity/enabled state.
- `kiwi_a2a_trust_add`, `kiwi_a2a_trust_list`, `kiwi_a2a_trust_remove`: manage trusted filesystem peers.
- `kiwi_a2a_publish`, `kiwi_a2a_sync`, `kiwi_a2a_inbox`, `kiwi_a2a_accept`: exchange and materialize trusted A2A handoffs.

Workspace-aware tools accept:

```json
{
  "workspacePath": "/Users/norberthanauer/Projects/voice",
  "repoId": "core",
  "repoPath": "/Users/norberthanauer/Projects/voice/voice-core"
}
```

Use either `repoId` or `repoPath`. `repoId` maps to the names listed by `kiwi workspace list`; `repoPath` can be absolute or relative to the workspace.

## Minimal Flow

```json
{
  "name": "kiwi_plan",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "repoId": "core",
    "ticket": "# Fix consent sync\n\n## Validate"
  }
}
```

Then:

```json
{
  "name": "kiwi_run",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "runId": "<run-id>"
  }
}
```

Finalize and inspect:

```json
{
  "name": "kiwi_finalize",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "runId": "<run-id>"
  }
}
```

## Resources

Resources expose the run store for the server workspace:

- `kiwi://runs`
- `kiwi://runs/{runId}`
- `kiwi://runs/{runId}/manifest`
- `kiwi://runs/{runId}/initiative`
- `kiwi://runs/{runId}/task-graph`
- `kiwi://runs/{runId}/planner-input`
- `kiwi://runs/{runId}/planner-output`
- `kiwi://runs/{runId}/planner-cost`
- `kiwi://runs/{runId}/attempts`
- `kiwi://runs/{runId}/final-summary`
- `kiwi://runs/{runId}/final-verdict`
- `kiwi://runs/{runId}/audit`
- `kiwi://runs/{runId}/evidence-manifest`
- `kiwi://runs/{runId}/operator-snapshot`
- `kiwi://runs/{runId}/artifacts/{artifactRef}`

For multi-repo work, start one server per workspace or set `AI_KIWI_WORKSPACE` per client config.

## Safety

- A run lock protects mutating operations.
- A2A is disabled by default and only exchanges filesystem envelopes with explicitly trusted peers.
- Remote patch artifacts are quarantined by the A2A runtime.
- Step worktrees copy only the selected repo, not the whole workspace.
