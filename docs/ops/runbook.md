# Operations Runbook

Status: draft

## Local Production Posture

- CLI is the reference operator surface.
- MCP mirrors supported operations and must stay thin over `packages/core`.
- A2A is disabled by default.
- A2A filesystem beta only exchanges envelopes with explicitly trusted sender IDs and inbox paths.
- Remote patch artifacts are quarantined until local apply gates exist.

## Standard Flow

```bash
kiwi init --workspace /path/to/workspace
kiwi workspace list --workspace /path/to/workspace
kiwi plan ./ticket.md --workspace /path/to/workspace --repo <repo-id>
kiwi status <run-id> --workspace /path/to/workspace
kiwi run <run-id> --workspace /path/to/workspace
kiwi finalize <run-id> --workspace /path/to/workspace
kiwi evidence manifest <run-id> --workspace /path/to/workspace
kiwi operator snapshot <run-id> --workspace /path/to/workspace
```

## A2A Loopback Check

```bash
kiwi a2a receive ./a2a-envelope.json --loopback --trusted-agent remote-agent
```

Expected result:

- trusted envelope: `status: accepted`
- repeated idempotency key: `status: duplicate`
- missing trust or disabled runtime: `status: blocked`

## A2A Filesystem Check

```bash
kiwi a2a enable --local-agent agent-a --workspace /path/to/a
kiwi a2a enable --local-agent agent-b --workspace /path/to/b
kiwi a2a trust add agent-b --inbox-path /path/to/b/.kiwi/a2a/transport/incoming --workspace /path/to/a
kiwi a2a trust add agent-a --inbox-path /path/to/a/.kiwi/a2a/transport/incoming --workspace /path/to/b
kiwi a2a publish task_graph --peer agent-b --run-id <run-id> --workspace /path/to/a
kiwi a2a sync --workspace /path/to/a
kiwi a2a sync --workspace /path/to/b
kiwi a2a inbox --workspace /path/to/b
```

## Evidence Recovery

For a run:

- `final/evidence-manifest.json` contains SHA-256 hashes for run artifacts.
- `final/audit-events.json` contains a run-scoped audit snapshot.
- `operator/index.html` is a static local view for operator inspection.
- `.kiwi/a2a/audit.log` contains global A2A receive decisions.
- `.kiwi/a2a/ledger/correlations/<correlation-id>/` links accepted peer messages.
- `.kiwi/a2a/quarantine/` contains corrupt envelopes and patch/diff artifacts.

## Incident Notes

- Do not apply remote patches directly from A2A quarantine.
- Do not bypass local quality gates for A2A handoffs.
- Treat missing audit/evidence manifests as a release blocker.
