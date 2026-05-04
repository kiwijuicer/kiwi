# Operations Runbook

Status: draft

## Local Production Posture

- CLI is the reference operator surface.
- MCP mirrors supported operations and must stay thin over `packages/core`.
- A2A is disabled by default.
- A2A loopback only accepts envelopes when explicitly enabled with trusted sender IDs.
- Remote patch artifacts are blocked until local apply gates exist.

## Standard Flow

```bash
kiwi init
kiwi plan ./ticket.md
kiwi status <run-id>
kiwi evidence manifest <run-id>
kiwi operator snapshot <run-id>
```

## A2A Loopback Check

```bash
kiwi a2a receive ./a2a-envelope.json --loopback --trusted-agent remote-agent
```

Expected result:

- trusted envelope: `status: accepted`
- repeated idempotency key: `status: duplicate`
- missing trust or disabled runtime: `status: blocked`

## Evidence Recovery

For a run:

- `final/evidence-manifest.json` contains SHA-256 hashes for run artifacts.
- `final/audit-events.json` contains a run-scoped audit snapshot.
- `operator/index.html` is a static local view for operator inspection.
- `.kiwi/a2a/audit.log` contains global A2A receive decisions.

## Incident Notes

- Do not apply remote patches directly.
- Do not bypass local quality gates for A2A handoffs.
- Treat missing audit/evidence manifests as a release blocker.
