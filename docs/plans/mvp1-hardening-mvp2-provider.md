# MVP1 Hardening + MVP2 Provider Plan

## Ziel

MVP1 wird gegen die Akzeptanzkriterien gehaertet. Danach wird der kleinste MVP2-Schnitt eingefuehrt: eine Planner-Provider-Grenze ohne echte LLM-Integration.

## Scope

- Bestehende MVP1-Foundation beibehalten.
- `kiwi plan <ticket>` Semantik konkretisieren und testen.
- Reproduzierbare Planning-Pfade fuer Tests und Artefakte ermoeglichen.
- Provider-Integration vorbereiten, aber weiterhin lokal und deterministisch planen.
- Keine Runner-Ausfuehrung, kein Sandbox-Runtime, kein MCP, kein Dashboard.

## Phase 1: MVP1 Hardening

- `kiwi plan <ticket>` unterstuetzt stabile Datei-Pfade und kann optional Inline-Tickettext verarbeiten.
- Tests validieren erzeugte `run.json`, `initiative.json` und `plan/task-graph.json` gegen Contracts-Schemas.
- ID- und Zeit-Erzeugung werden fuer Tests injizierbar, damit reproduzierbare Artefakte moeglich sind.
- Akzeptanz-Gate: `pnpm test` und `pnpm typecheck` laufen gruen.

## Phase 2: MVP2 Provider Boundary

- `packages/adapters` enthaelt Provider-nahe Contracts und Stub-Implementierungen.
- `PlannerProvider` kapselt Planner-Aufrufe mit typisiertem Input und Output.
- `StubPlannerProvider` nutzt den bestehenden deterministischen Planner.
- Provider-Output wird gegen `TaskGraphSchema` validiert.
- Ein einfacher Retry-Wrapper wiederholt invaliden Provider-Output deterministisch begrenzt.
- `planner-input.json` und `planner-output.json` werden unter `.kiwi/runs/<run-id>/plan/` persistiert.
- Output enthaelt initiale Retry- und Cost-Metadaten, ohne echte Kostenabrechnung.

## Akzeptanzkriterien

- MVP1-Artefakte validieren in Tests ueber `@ai-kiwi/contracts`.
- Planning bleibt local-first und in Tests reproduzierbar.
- Provider-Grenze existiert ohne echte LLM-Abhaengigkeit.
- Planner-Input und Planner-Output werden im dokumentierten Run-Layout persistiert.
- `pnpm test` und `pnpm typecheck` sind gruen.
