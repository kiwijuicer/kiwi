# Operations Runbook

Status: draft

## Local Production Posture

- CLI is the reference operator surface.
- MCP mirrors supported operations and must stay thin over `packages/core`.
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

## Evidence Recovery

For a run:

- `final/evidence-manifest.json` contains SHA-256 hashes for run artifacts.
- `final/audit-events.json` contains a run-scoped audit snapshot.
- `operator/index.html` is a static local view for operator inspection.

## Incident Notes

- Treat missing audit/evidence manifests as a release blocker.
