# MVP 1 Specification

## Ziel

Eine kleine, stabile Planning Foundation fuer `kiwi`, ohne Runner oder echte LLM-Ausfuehrung.

## In Scope

- Monorepo Setup (`apps/*`, `packages/*`)
- `packages/contracts` mit Zod-Schemas
- `packages/core` mit:
  - Initiative creation
  - deterministic TaskGraph planner
  - Run Store unter `.kiwi/runs/<run-id>/`
  - Status aggregation
- `apps/cli` mit:
  - `kiwi init`
  - `kiwi plan <ticket>`
  - `kiwi status`
- Default `kiwi-policy.yaml` und `model-registry.yaml`
- Unit tests fuer contracts/core/cli

## Out Of Scope

- echte LLM provider integration
- step execution runner
- worktree sandbox runtime
- MCP server
- dashboard / tui
- A2A
- automatische codeaenderungen

## Akzeptanzkriterien

- `kiwi init` erzeugt `.kiwi/config.yaml`, `.kiwi/runs/`, `kiwi-policy.yaml`, `model-registry.yaml`.
- `kiwi plan <ticket>` erzeugt:
  - `.kiwi/runs/<run-id>/run.json`
  - `.kiwi/runs/<run-id>/initiative.json`
  - `.kiwi/runs/<run-id>/plan/task-graph.json`
- erzeugte Dateien validieren gegen die Contracts-Schemas.
- `kiwi status` liefert eine lesbare Zusammenfassung.
- Testsuite fuer MVP 1 laeuft gruen.

## Design Guardrails

- `agentRole` und `modelCapability` nicht mischen.
- keine direct main-branch writes.
- run artifacts bleiben lokal und nachvollziehbar.
- scope creep aktiv vermeiden.
