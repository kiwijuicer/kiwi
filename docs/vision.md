# kiwi Vision v2

Local-first AI coding control plane fuer planbare, sichere und kosteneffiziente Umsetzung von Tickets und Features.

Version: 0.2
Status: Canonical architecture draft
Primary stack: TypeScript, pnpm, Zod, CLI-first

---

## 1) Kurzfassung

`kiwi` ist eine lokale Orchestrierungs- und Qualitaetsschicht zwischen Mensch, IDE, CLI und mehreren Modellen/Runnern.

Kernidee:

- High-end Modelle planen, bewerten Risiko und reviewen.
- Guenstigere Modelle fuehren klar abgegrenzte Steps aus.
- Jeder Step laeuft nachvollziehbar in einer lokalen, kontrollierten Umgebung.
- Entscheidungen, Kosten, Diffs und Gates werden persistiert.
- Riskante Aenderungen werden nie blind uebernommen.

---

## 2) Produktziele

### 2.1 Muss-Ziele

- Aus vagen Inputs reproduzierbare TaskGraphs erzeugen.
- Code-Erstellung, Code-Aenderung und Refactoring als geplante, gegatete Steps orchestrieren.
- Execution und Review strikt trennen.
- Safety und Auditability als First-Class Features behandeln.
- Kosten aktiv steuern statt nur messen.
- IDE-unabhaengig bleiben (CLI ist die Kernoberflaeche).
- SCM-provider-neutral bleiben; Bitbucket Cloud ist ein First-Class Ziel neben GitHub.

### 2.2 Non-Goals fuer den Start

- Keine vollautomatische End-to-End-Entwicklung ohne Gates.
- Kein A2A-System in MVP 1.
- Kein Multi-Tenant SaaS-Backend in MVP 1.
- Kein Dashboard als Pflicht fuer MVP 1.

---

## 3) Leitprinzipien

- Local-first by default.
- Small diffs over big-bang changes.
- Policy before execution.
- Risk > Budget.
- Test evidence before acceptance.
- Deterministic artifacts before summary text.
- KISS, DRY, SRP auf Modul- und Code-Ebene.

---

## 4) Kanonisches Domaenenmodell

Diese Begriffe sind verbindlich und werden in Code, CLI, Schemas, Logs, API und MCP identisch verwendet.

### 4.1 Initiative

Eingangsanliegen (Ticket, Feature, Bug, Refactoring-Idee, Review-Auftrag).

Pflichtfelder:

- `id`
- `title`
- `rawInput`
- `source` (`cli | file | mcp | api`)
- `repoPath`
- `riskProfile`
- `budgetProfile`
- `createdAt`

### 4.2 Run

Eine konkrete Orchestrierung einer Initiative mit eigener Persistenz unter `.kiwi/runs/<run-id>/`.

Pflichtfelder:

- `runId`
- `initiativeId`
- `status`
- `currentPlanId`
- `createdAt`
- `updatedAt`

Workspace-Metadaten fuer Multi-Repo-Workspaces:

- `workspacePath`
- `repoId`
- `repoPath`

### 4.3 TaskGraph

Maschinenlesbarer Plan mit Schritten, Abhaengigkeiten und akzeptierbaren Ergebnissen.

Pflichtfelder:

- `planId`
- `runId`
- `summary`
- `steps[]`
- `acceptanceCriteria[]`
- `assumptions[]`
- `openQuestions[]`
- `riskScore`
- `complexityScore`

### 4.4 Step

Logische Arbeitseinheit im TaskGraph.

Pflichtfelder:

- `stepId`
- `type`
- `title`
- `dependsOn[]`
- `successCriteria[]`
- `requiredGates[]`
- `recommendedAgentRole`
- `recommendedModelCapability`

### 4.5 StepAttempt

Konkreter Ausfuehrungsversuch eines Steps mit Runner, Modell, Kontextpaket und Artefakten.

Pflichtfelder:

- `attemptId`
- `stepId`
- `runner`
- `agentRole`
- `modelCapability`
- `status`
- `contextPackageRef`
- `artifacts[]`
- `startedAt`
- `completedAt`

### 4.6 Artifact

Persistiertes Ergebnisobjekt aus einem StepAttempt.

Typen:

- `diff`
- `patch`
- `command_output`
- `test_report`
- `lint_report`
- `typecheck_report`
- `review_report`
- `cost_report`
- `summary`

### 4.7 GateResult

Maschinenlesbares Ergebnis eines Gates.

Pflichtfelder:

- `gateId`
- `gateType`
- `status` (`pass | fail | blocked`)
- `evidenceRefs[]`
- `reason`

### 4.8 ReviewVerdict

Strukturiertes Ergebnis des Review Engines.

Pflichtfelder:

- `verdict` (`pass | pass_with_comments | needs_changes | reject`)
- `safeToContinue`
- `issues[]`
- `recommendedNextSteps[]`
- `confidence`

### 4.9 SCM Provider Boundary

SCM-Integrationen sind Adapter, nicht Core-Logik.

Pflichtregeln:

- Core speichert keine Credentials.
- Authentifizierung liegt ausserhalb von Kiwi: lokaler CLI-Login, OAuth Connector, MCP Server, OS Keychain oder ein injizierter HTTP-Transport.
- Bitbucket Cloud (`bitbucket.org`) ist als First-Class Provider vorgesehen.
- GitHub bleibt moeglich, darf aber keine Bitbucket-spezifischen Flows erzwingen.

Unterstuetzte SCM-Aktionen:

- Ticket/Issue Draft oder Remote-Erstellung
- Pull Request Draft oder Remote-Erstellung
- Pull Request Review Kommentare, Tasks und Change-Request Signal

---

## 5) Rollen vs. Modellfaehigkeit

Wichtige Trennung:

- `agentRole` beschreibt Aufgabe/Funktion im System.
- `modelCapability` beschreibt Kosten- und Leistungsniveau.

### 5.1 Agent Roles

- `planner`
- `researcher`
- `executor`
- `reviewer`
- `security`
- `rules`

### 5.2 Model Capability Tiers

- `cheap`
- `mid`
- `strong`
- `frontier`

### 5.3 Grundregel

`frontier` ist Standard fuer Planning + Final Review, aber nicht Standard fuer jede Execution.

---

## 6) Zielarchitektur

```mermaid
flowchart TD
  intake[InitiativeIntake] --> planner[Planner]
  planner --> graph[TaskGraphStore]
  graph --> scheduler[SchedulerPolicyEngine]
  scheduler --> stepAttempt[StepAttemptOrchestrator]
  stepAttempt --> adapter[RunnerAdapter]
  adapter --> sandbox[WorktreeSandbox]
  sandbox --> artifacts[ArtifactsStore]
  artifacts --> gates[QualityGates]
  gates --> review[ReviewEngine]
  review --> finalizer[Finalizer]
  review --> replanner[Replanner]
  replanner --> graph
  artifacts --> audit[AuditAndCostLedger]
  gates --> audit
  review --> audit
```

### 6.1 Modulgrenzen

- `packages/contracts`: Zod schemas, types, shared enums.
- `packages/core`: orchestration, scheduling, planning flow, run store.
- `packages/adapters`: provider + runner integration adapters.
- `packages/sandbox`: worktree, process execution, permissions, secret filtering.
- `apps/cli`: primary interface.
- `apps/mcp-server`: integration channel fuer IDEs.

### 6.2 Dependency-Richtung

- Apps duerfen auf Packages zeigen.
- `core` darf `contracts` konsumieren.
- `adapters` und `sandbox` duerfen `contracts` konsumieren.
- `core` spricht Runner nur ueber Adapter-Interfaces an.

---

## 7) Runner und Ausfuehrungsmodell

### 7.1 RunnerAdapter Contract

Runner werden austauschbar ueber ein gemeinsames Interface angebunden.

```ts
export interface RunnerAdapter {
  readonly name: "codex" | "claude-code" | "local-shell" | "api";
  execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput>;
}
```

Minimum in `RunnerExecutionInput`:

- `attemptId`
- `workspacePath`
- `worktreePath`
- `stepPrompt`
- `contextPackage`
- `allowedTools`
- `timeouts`

Minimum in `RunnerExecutionOutput`:

- `status`
- `artifactRefs`
- `rawLogsRef`
- `modelUsage`
- `error` (optional)

### 7.2 Worktree-Regel

Keine direkte Aenderung am Haupt-Working-Tree durch Runner.

Strategie:

- Run besitzt einen isolierten Run-Worktree.
- Jeder StepAttempt erzeugt Patch/Artifacts in diesem Run-Kontext.
- Anwendung auf Main-Tree erst nach Gates und Freigabe.

---

## 8) Persistenzlayout unter .kiwi

```text
.kiwi/
  config.yaml
  runs/
    run_2026_05_03_001/
      run.json
      initiative.json
      plan/
        task-graph.json
        planner-input.json
        planner-output.json
      steps/
        step_001/
          attempt_001/
            attempt.json
            context-package.json
            artifacts/
              diff.patch
              command-output.txt
              test-report.json
              review-report.json
              cost-report.json
            gate-results.json
      final/
        final-summary.md
        final-verdict.json
        final-cost-report.json
  logs/
    audit.log
```

Wichtig:

- Keine Einzeldatei `.kiwi/runs/<id>.json` als Endzustand.
- Run-Ordner ist die kanonische Persistenzform.

---

## 9) Scheduler und Routing

Der Scheduler trifft finalen Routing-Entscheid pro StepAttempt anhand von:

- Step-Typ
- Risiko
- blast radius
- security sensitivity
- context size
- historische Erfolgsquote
- Budget Rest
- Runner availability

Routing ist zweistufig:

1. `agentRole` bestimmen
2. `modelCapability` bestimmen

Dann:

- Runner waehlen
- Context Level waehlen
- Gates waehlen
- Review-Tiefe waehlen

### 9.1 Risiko-Uebersteuerung

Risk zones erzwingen mindestens:

- `strong` execution
- `frontier` review
- ggf. human approval

---

## 10) Context Packaging

Kontext wird abgestuft erzeugt, nie blind das gesamte Repo.

Levels:

- `L0`: initiative + policy + registry + wichtigste commands
- `L1`: relevante Dateien + tests + recent diff
- `L2`: symbols + grep hits + commit context + traces
- `L3`: breitere Architekturkontexte + historical run outcomes

Context package ist als JSON Artifact persistiert.

---

## 11) Quality Gates und Review

### 11.1 Mindest-Gates pro Coding-Step

- `typecheck`
- `lint`
- relevante tests
- forbidden file checks
- secrets check

### 11.2 Review Engine

Review ist strukturiertes JSON, nie nur Freitext.

Mindestoutput:

- `verdict`
- `safeToContinue`
- `issues[]` mit `severity`
- `recommendedNextSteps[]`
- `confidence`

### 11.3 Feedback Loop

`needs_changes` oder `reject` erzeugt replanning oder fix-step.

---

## 12) Security Model

### 12.1 Defaults

- no direct writes to main branch
- no dependency install without approval
- no migration execution without approval
- no unrestricted shell by default
- no production credentials in run context

### 12.2 Mechanismen

- command allowlist pro step type
- path denylist/risk zones
- env allowlist + secret redaction
- network policy per attempt
- hard timeout + process limits
- audit log events fuer jede Entscheidung

### 12.3 Approval States

- `auto` (safe)
- `required` (must confirm)
- `blocked` (policy prohibits)

---

## 13) Cost Control

Kostensteuerung ist aktiver Scheduler-Input, kein Reporting-only.

- Budgetprofile: `tiny | small | normal | large | critical`
- Budget gilt pro Run
- Restbudget beeinflusst Context Level und modelCapability
- Sicherheitsanforderungen duerfen nicht heruntergeroutet werden

Grundregel:

`risk > budget`

---

## 14) Integrationsschichten

### 14.1 CLI (primaer)

CLI ist der Startpunkt und bleibt Referenz fuer alle Flows.

### 14.2 MCP (spaeter)

MCP ist Zugriffskanal, nicht Orchestrator.

### 14.3 A2A (deutlich spaeter)

A2A wird erst relevant, wenn interne Rollen stabil sind und ueber saubere contracts verfuegen.

### 14.4 SCM Provider

SCM Provider werden ueber `packages/adapters` angebunden.

Startreihenfolge:

1. Bitbucket Cloud Adapter fuer Issues, Pull Requests und Pull Request Reviews.
2. GitHub Adapter nur als zweiter Provider, nicht als Annahme im Core.
3. Lokale Draft-Ausgabe als Fallback, wenn keine externe Auth verfuegbar ist.

---

## 15) Ziel-Repo-Struktur

```text
kiwi/
  apps/
    cli/
    mcp-server/
  packages/
    contracts/
    core/
    adapters/
    sandbox/
  docs/
    vision.md
    architecture.md
    mvp1.md
    rules/
      project.md
      architecture.md
      typescript.md
      testing.md
      security.md
      agents.md
  .kiwi/
    config.yaml
    policy.yaml
    .kiwi/model-registry.yaml
  AGENTS.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

---

## 16) AGENTS und Rules als Source of Truth

`AGENTS.md` ist Einstiegspunkt fuer Agenten und verlinkt auf fokussierte Regeln in `docs/rules/`.

Regelquellen:

- `docs/rules/project.md`
- `docs/rules/architecture.md`
- `docs/rules/typescript.md`
- `docs/rules/testing.md`
- `docs/rules/security.md`
- `docs/rules/agents.md`

Optional spaeter:

- Generierung nach `.cursor/rules/*.mdc` aus diesen Quellen.

---

## 17) MVP Scope

### 17.1 MVP 1 (strict)

Enthalten:

- monorepo bootstrap
- `packages/contracts` mit Zod Schemas
- `packages/core` mit intake, deterministic planner, run store
- `apps/cli` mit:
  - `kiwi init`
  - `kiwi plan <ticket>`
  - `kiwi status`
- Persistenz unter `.kiwi/runs/<run-id>/`
- Tests fuer contracts/core/cli

Nicht enthalten:

- echte LLM Calls
- runner execution
- MCP server
- dashboard/tui
- a2a
- automatische codeaenderungen

### 17.2 MVP 2

- echte planner provider integration
- schema validation + retries
- basic cost accounting

### 17.3 MVP 3

- structured diff review
- gate evidence integration
- fix-step feedback loop

### 17.4 MVP 4

- worktree sandbox
- first runner adapters
- command gate execution

### 17.5 MVP 5+

- full initiative orchestration
- MCP server
- rules sync
- dashboard/tui
- a2a preparation

---

## 18) Clean Start Strategie

Nach Finalisierung dieser Vision wird die bestehende MVP-Implementierung kontrolliert ersetzt.

Behalten:

- `docs/vision.md`
- `AGENTS.md`
- `docs/rules/*`
- Git Historie und Repo-Metadaten

Neu aufsetzen:

- `apps/*`
- `packages/*`
- Root Configs falls nicht passend zum neuen Scope
- alte `.kiwi` run artifacts

---

## 19) Abnahmekriterien fuer diese Vision

Die Vision gilt als umsetzbar, wenn:

- Begriffe sind eindeutig und widerspruchsfrei.
- Rollen und Modelltiers sind getrennt definiert.
- Run-/Step-/Artifact-Persistenz ist klar beschrieben.
- Runner/Sandbox Contracts sind konkret genug fuer Implementierung.
- MVP 1 ist klein, testbar und gegen Scope Creep abgesichert.
- AGENTS/Rules sind als verbindliche Quellen vorgesehen.

---

## 20) Schluss

Erster Proof ist nicht "vollstaendig autonom coden", sondern:

Kann `kiwi` aus einem unklaren Ticket reproduzierbar einen sicheren, kostenbewussten und reviewbaren TaskGraph plus Run-Artefakte erzeugen?

Wenn ja, ist die Grundlage fuer skalierbare Orchestrierung gelegt.
