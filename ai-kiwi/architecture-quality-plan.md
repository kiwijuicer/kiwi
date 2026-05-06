# ai-kiwi — Architektur- & Qualitäts-Plan

**Status:** Planungsphase, kein Code, kein Repo-Setup. Greenfield.
**Datum:** 2026-05-06
**Rolle Claude:** Lead Architect

Dieses Dokument bewertet die sieben primären Qualitätsziele, übersetzt sie in konkrete Architekturentscheidungen und legt eine Reihenfolge fest, in der sie erfüllt werden — ohne dass schon Code geschrieben wird.

---

## 1. Schnellbewertung der 7 Ziele

| #  | Ziel                                                           | Aktuell | Verankert durch                                       |
|----|----------------------------------------------------------------|---------|-------------------------------------------------------|
| 1  | Code Quality & Architektur (high level)                        | offen   | Hexagonal/DDD-Layering, strict TS, ADRs               |
| 2  | LLM-Kosteneffizienz (so niedrig wie möglich)                   | offen   | Modell-Routing-Layer, Caching, Budget-Guardrails      |
| 3  | Ease-of-Use für alle Entwickler-Level                          | offen   | CLI-DX, sinnvolle Defaults, progressive Disclosure    |
| 4  | Analyze → Research → Plan → Split → Execute (||/seq)           | offen   | Task-Graph + Scheduler + Stage-Pipeline               |
| 5  | High-end LLM für Analyse/Plan/Review                           | offen   | Stage-gebundene Modell-Policy, nicht prompt-gebunden  |
| 6  | Transparenz: Kosten, Modellwahl, Logs                          | offen   | Structured Event Log, lokale SQLite, `kiwi cost`      |
| 7  | Gute Developer-UX im Zusammenspiel mit (3)                     | offen   | TTY + JSON Modus, klare Fehler, `--explain`, Watch   |

Da nichts gebaut ist, ist das keine Schwäche — das ist die Chance, alle sieben Ziele **als Architekturzwang** statt als nachträgliche Best Practice einzubauen.

---

## 2. Leitprinzipien (was wir nicht verhandeln)

1. **Local-first.** Alle Artefakte (Logs, Cache, Pläne, Task-Graphen) liegen im Repo bzw. in `.kiwi/`. Keine Server-Abhängigkeit für die Kernfunktion.
2. **Modellwahl ist eine Konfigurationsfrage, keine Code-Frage.** Welches Modell welche Stage ausführt, steht in `kiwi.config.ts` und ist zur Laufzeit überschreibbar — niemals hardcoded.
3. **Jede LLM-Interaktion ist ein Event.** Strukturiert geloggt mit Tokens, Kosten, Latenz, Stage, Ticket-ID, Prompt-Hash. Kein Call ohne Telemetrie.
4. **Pläne und Reviews sind erste Bürger.** Sie sind eigene Artefakte (`plans/`, `reviews/`), nicht flüchtige Chat-Outputs.
5. **CLI-First, UI später.** Alles muss skriptbar sein. Eine TUI/Web-UI ist später ein dünner Layer über denselben Commands.
6. **MCP ist Integration, nicht Kern.** Die Kern-Domain weiß nichts von MCP. MCP-Tools sind Adapter im Infrastructure-Layer.
7. **A2A nur vorbereiten.** V1 hat einen Single-Process-Orchestrator. Die Schnittstelle zum Scheduler ist aber so geschnitten, dass ein verteilter Backend-Tausch in V2 möglich ist (siehe §10).

---

## 3. Architektur-Skizze (logisch)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLI (kiwi)                                    │
│   commands: init · plan · run · review · cost · logs · explain      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                     Application Layer                                │
│   Use-Cases: AnalyzeTicket · BuildPlan · DecomposeIntoTasks ·        │
│              ExecuteTaskGraph · ReviewResult                         │
└─────────────┬─────────────────────────────────┬──────────────────────┘
              │                                 │
┌─────────────▼─────────────┐         ┌─────────▼────────────────────┐
│   Domain Layer            │         │   Orchestration Layer        │
│   Ticket · Plan · Task ·  │         │   TaskGraph · Scheduler ·    │
│   TaskGraph · Review ·    │         │   StageRunner · BudgetGuard  │
│   Budget · ModelChoice    │         │                              │
└───────────────────────────┘         └─────────┬────────────────────┘
                                                │
┌───────────────────────────────────────────────▼──────────────────────┐
│                  Infrastructure Layer (Ports & Adapters)             │
│   LLMProvider (OpenAI/Anthropic/local) · ModelRouter ·               │
│   PromptCache · SemanticCache · EventLog · CostLedger ·              │
│   FileStore · GitAdapter · MCPClient (V1.5+) · A2AStub (V2)         │
└──────────────────────────────────────────────────────────────────────┘
```

Wichtige Eigenschaften:

- **Domain kennt keine LLMs.** `ModelChoice` ist ein Wert, kein Provider. Die Domain sagt „Stage = Plan, erfordert Tier = high", die Infra entscheidet, welches konkrete Modell.
- **Orchestration ist getrennt von Application.** Use-Cases wissen nicht, ob Tasks parallel oder seriell laufen — der Scheduler entscheidet.
- **Ports überall.** Jeder externe Effekt (LLM, FS, Git, MCP) ist hinter einem Interface. Damit ist Mocking trivial und V2-Backend-Tausch (A2A) möglich.

---

## 4. Modell-Routing & Kosteneffizienz (Ziel 2 + 5)

### 4.1 Stage-Tier-Mapping (Default)

| Stage         | Tier      | Begründung                                             |
|---------------|-----------|--------------------------------------------------------|
| Analyze       | high      | Architektur-Verständnis, Mehrdeutigkeit auflösen       |
| Research      | mid       | Strukturierte Recherche, oft Tool-Use                  |
| Plan          | high      | Hauptwertschöpfung — schlechter Plan = teure Execution |
| Decompose     | high      | Falsche Zerlegung kaskadiert in alle Sub-Tasks         |
| Execute       | mid/low   | Atomar, eng gefasst, gut testbar                       |
| Summarize     | low       | Klassifikation/Verdichtung                             |
| Review        | high      | Qualitätsgate — muss Fehler des Executors fangen       |

### 4.2 Routing-Regeln

1. **Tier statt Modellname.** Code sagt `tier: 'high'`, nicht `model: 'opus-4-6'`. Config mappt Tier → Modell.
2. **Override-Kette:** CLI-Flag > Env > Projekt-Config > Default.
3. **Fallback bei Rate-Limit:** Nächstniedriger Tier mit Warnung im Log (statt harter Fehler).
4. **Budget-Guard:** Pro Run ein Soft-Cap (warnt) und Hard-Cap (bricht ab). Default-Hard-Cap z.B. 5 USD pro Ticket — konfigurierbar.

### 4.3 Cache-Strategie

- **Prompt Cache (Provider-nativ):** System-Prompts und große Kontexte werden cached; Cache-Marker in jedem Adapter aktiv.
- **Semantic Cache (lokal):** Hash über (Stage, Modell, normalisierter Prompt, relevanter Repo-Snapshot). Bei Cache-Hit kein API-Call. Standard-TTL: bis Repo-State sich ändert.
- **Plan-Reuse:** Identische Tickets → identischer Plan-Hash → reuse, sofern User nicht `--fresh` setzt.

### 4.4 Token-Hygiene

- Kontext nur lesen, was die Stage braucht (kein „lade das ganze Repo" als Reflex).
- Repo-Indexer (TF-IDF/Embeddings, lokal) liefert Top-K relevante Dateien pro Stage.
- Lange Outputs erzwingen Streaming + Early-Stop-Kriterien (z.B. Plan endet, sobald JSON-Schema valide).

---

## 5. Pipeline: Analyze → Research → Plan → Decompose → Execute → Review (Ziel 4)

### 5.1 Stages als Pure Functions auf Domain-Modellen

```
Ticket
   → Analyze   → AnalysisReport
   → Research  → ResearchNotes
   → Plan      → Plan
   → Decompose → TaskGraph (DAG)
   → Execute   → ExecutionResult[]   (parallel wo erlaubt)
   → Review    → ReviewVerdict       (gate)
```

Jede Stage:
- ist deterministisch in ihrer Schnittstelle (Input-Typ → Output-Typ),
- hat ein definiertes Tier (überschreibbar),
- emittiert Events (`stage.started`, `stage.completed`, `llm.call`, `cost.recorded`),
- ist eigenständig wiederholbar (Re-Run ohne Re-Run der vorherigen Stages).

### 5.2 Task-Graph & Scheduler

- **Knoten:** atomarer Task mit `id`, `dependsOn[]`, `tier`, `inputs`, `expectedOutput`.
- **Kanten:** harte Abhängigkeiten (Reihenfolge erzwungen) vs. weiche (nur Datenfluss).
- **Scheduler-Modi:**
  - `sequential` — Default für V1 (einfach debugbar)
  - `parallel` — opt-in via Flag oder pro Graph; respektiert `maxConcurrency`
  - `dry-run` — zeigt nur den Graph + geschätzte Kosten, kein API-Call
- **Geschätzte Kosten vor Ausführung:** Scheduler summiert pro Knoten die erwartete Token-Last × Tier-Preis und zeigt Gesamtsumme zur Bestätigung an, falls `--confirm-budget`.

### 5.3 Review-Gate (Ziel 5 explizit)

- Review läuft auf **high tier**, auch wenn Execution low/mid war.
- Review-Verdict ist strukturiert: `pass`, `pass-with-notes`, `fail`, jeweils mit konkretem Issue-Liste.
- Bei `fail`: automatischer Re-Plan-Loop, max. N Iterationen (Default 2), dann an User.

---

## 6. Domain-Modelle (Skizze)

```ts
type Tier = 'high' | 'mid' | 'low';

type Ticket      = { id, title, description, acceptance, constraints };
type AnalysisReport = { ticketId, ambiguities[], assumptions[], risks[] };
type Plan        = { ticketId, steps[], rationale, estCostUsd, estTokens };
type Task        = { id, planId, description, inputs, dependsOn, tier };
type TaskGraph   = { planId, tasks: Task[], parallelizable: boolean };
type ExecutionResult = { taskId, output, modelUsed, tokens, costUsd, durationMs };
type ReviewVerdict   = { runId, verdict, issues[], suggestion };
type CostLedger      = { runId, perStage, perModel, perTask, total };
type LLMCallEvent    = { ts, runId, stage, model, tier, tokensIn, tokensOut, costUsd, latencyMs, cacheHit, promptHash };
```

Wichtig:
- `costUsd` ist im Domain-Modell, nicht im Log-Anhängsel — dadurch landet Kosteninformation strukturiert überall.
- `cacheHit` ist Teil des Events, sodass „wie viele Tokens haben wir gespart?" direkt auswertbar ist.
- `promptHash` ermöglicht Reproduzierbarkeit & Cache-Audits.

---

## 7. Repo-Struktur (geplant)

```
ai-kiwi/
├── packages/
│   ├── core/                  # Domain + Application Layer (LLM-frei testbar)
│   │   ├── domain/
│   │   ├── application/       # Use-Cases
│   │   └── orchestration/     # TaskGraph, Scheduler, BudgetGuard
│   ├── adapters/              # Infrastructure (LLM, FS, Git, Cache, MCP)
│   │   ├── llm-anthropic/
│   │   ├── llm-openai/
│   │   ├── llm-local/
│   │   ├── cache/
│   │   ├── eventlog/
│   │   └── mcp/               # ab V1.5
│   ├── cli/                   # `kiwi` Binary
│   └── shared/                # Types, utils
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── prompts/               # versionierte Stage-Prompts
│   └── runbook.md
├── examples/                  # Beispiel-Tickets, Beispiel-Pläne
├── .kiwi/                     # Lokaler State (gitignored)
│   ├── events.jsonl
│   ├── cost.sqlite
│   ├── cache/
│   └── runs/<runId>/
├── kiwi.config.ts             # User-facing Config
├── tsconfig.base.json
├── package.json (workspace)
└── README.md
```

Begründung Monorepo: `core` muss ohne Adapter testbar bleiben; saubere Trennung erzwingt Hexagonal-Struktur statt Lippenbekenntnis.

---

## 8. Transparenz & Logging (Ziel 6)

### 8.1 Drei Datenebenen

1. **Event-Log (`.kiwi/events.jsonl`):** append-only, eine Zeile pro Event. Roh-Wahrheit.
2. **Cost-Ledger (`.kiwi/cost.sqlite`):** abgeleitete View für Queries. Wird aus dem Event-Log rebuildet — Event-Log ist Source of Truth.
3. **Run-Bundle (`.kiwi/runs/<runId>/`):** Plan, TaskGraph, alle Prompts, alle Outputs, Review. Komplett auditierbar pro Run.

### 8.2 CLI-Sichtbarkeit

- `kiwi cost` — Zusammenfassung Run/Tag/Woche, Kosten pro Stage und pro Modell.
- `kiwi cost --by-tier` — wie viel an high vs. mid vs. low geht (Plausibilitätscheck für Ziel 2).
- `kiwi logs <runId>` — chronologischer Verlauf eines Runs.
- `kiwi explain <runId>` — Klartext-Zusammenfassung „warum wurde dieser Plan gewählt, welche Modelle, was hat es gekostet". Erzeugt vom **low-tier**-Modell aus den Events.
- `kiwi cache stats` — Hit-Rate des Semantic-Caches (Hauptindikator für Kosteneffizienz).

### 8.3 Für Reviews relevante Metriken

- Kosten pro abgeschlossenem Ticket
- High-Tier-Anteil (sollte um die Plan/Review-Stages konzentriert sein)
- Cache-Hit-Rate
- Re-Plan-Rate (Indikator für Plan-Qualität)
- Median-Latenz pro Stage

---

## 9. Developer-UX & Ease-of-Use (Ziel 3 + 7)

### 9.1 Drei Komplexitätsstufen für User

| Stufe       | Was sie sehen                                                  | Wie sie kiwi nutzen                          |
|-------------|----------------------------------------------------------------|----------------------------------------------|
| Einsteiger  | `kiwi run "Beschreibung"` — fertig                             | Defaults, sequential, sichere Limits         |
| Fortgeschr. | `kiwi plan` separat, prüft, dann `kiwi run --plan plan.json`   | Plan-Review zwischendrin                     |
| Power       | `kiwi.config.ts` mit Custom-Stages, Modell-Overrides, Hooks    | Eigene Tier-Policies, eigene Stages          |

### 9.2 UX-Standards

- **Kein lautes Logging im Default.** Spinner + Eine-Zeile-Status pro Stage. Volle Logs unter `--verbose` oder im Run-Bundle.
- **Strukturierte Fehler.** Jeder Fehler hat: was passiert ist, wahrscheinliche Ursache, nächster Schritt. Niemals nackte Stack-Traces.
- **`--dry-run` überall.** Plan zeigen, Kosten schätzen, kein API-Call.
- **`--json` everywhere.** Maschinen-Output für Scripting.
- **Confirm-Prompts an einer Stelle.** Bei `--confirm-budget` bzw. wenn Hard-Cap überschritten würde.
- **Hilfe ist eingebaut.** `kiwi <cmd> --help` zeigt Beispiele, nicht nur Flags.

### 9.3 Onboarding

- `kiwi init` schreibt eine kommentierte Beispiel-Config + ein Beispiel-Ticket + ein Beispiel-Run-Bundle aus dem Examples-Verzeichnis.
- `kiwi doctor` prüft API-Keys, Modell-Verfügbarkeit, Disk, Git.
- README hat klar getrennte Pfade für „Erstes Mal", „Daily Driver", „Custom Setup".

---

## 10. Implementierungs-Reihenfolge

Phasen sind so geschnitten, dass jede für sich nutzbar ist (Walking-Skeleton-Prinzip).

**Phase 0 — Fundament (kein LLM nötig)**
1. Monorepo-Setup, strict TS, ESLint, Vitest, Prettier
2. `core/domain` Typen ohne Logik
3. `core/orchestration` TaskGraph + Scheduler-Stub (sequential)
4. Event-Log + Cost-Ledger Adapter (Ports + In-Memory + File-Implementierung)
5. CLI-Skeleton (`init`, `doctor`)

**Phase 1 — Erste End-to-End-Pipeline**
6. LLM-Provider-Port + ein Anthropic-Adapter
7. Stages: Analyze, Plan (erste minimale Versionen, high tier)
8. Stage: Execute (mid tier, ein simples Beispiel-Ticket)
9. `kiwi run` führt Analyze→Plan→Execute aus, schreibt Run-Bundle
10. `kiwi cost`, `kiwi logs` Basisversion

**Phase 2 — Qualitätsziele scharfschalten**
11. Decompose + TaskGraph-Generierung
12. Parallel-Scheduler (opt-in)
13. Review-Stage + Re-Plan-Loop
14. Semantic-Cache
15. Budget-Guard mit Soft/Hard-Caps

**Phase 3 — Erweiterung**
16. Zweiter LLM-Provider (Fallback-Pfad testen)
17. `kiwi explain` (low-tier-Zusammenfassung)
18. ADRs für die ersten 5–10 Entscheidungen rückwirkend dokumentieren
19. Examples-Verzeichnis mit 3 realen Beispiel-Tickets

**Phase 4 — Integration (V1.5)**
20. MCP-Adapter (Tool-Nutzung in Research/Execute)
21. A2A-Stub: Scheduler-Interface so abstrahieren, dass V2 Remote-Worker einsteckbar wären — kein echter Remote-Code

V1 = Phase 0–3.

---

## 11. Offene Architekturentscheidungen (ADR-Kandidaten)

1. **ADR-001:** Monorepo (npm workspaces vs. pnpm vs. turbo) — Empfehlung: pnpm workspaces, schlank, kein Build-Cache-Overhead in V1.
2. **ADR-002:** Task-Graph-Repräsentation — eigene Typen vs. bestehende Lib (z.B. `dagre`/`graphology`) — Empfehlung: eigene minimale Typen, Lib erst bei Visualisierungsbedarf.
3. **ADR-003:** Cost-Ledger-Storage — SQLite via `better-sqlite3` vs. JSONL-only — Empfehlung: JSONL als Truth, SQLite als View, beide ab V1.
4. **ADR-004:** Prompt-Versionierung — Files in `docs/prompts/` vs. inline mit Hash — Empfehlung: Files + Hash in Event-Log.
5. **ADR-005:** Scheduler-Konkurrenzmodell — Promise-pool vs. Worker-Threads — Empfehlung: Promise-pool für V1, Worker-Threads erst wenn CPU-bound.
6. **ADR-006:** LLM-Streaming — sofort vs. nach V1 — Empfehlung: ab Phase 2 nötig (UX + Early-Stop).
7. **ADR-007:** Tier-Definition — fest („high/mid/low") vs. frei benennbar — Empfehlung: fest in V1, später erweiterbar.
8. **ADR-008:** Wie wird der „Repo-Snapshot" für Cache-Keys ermittelt — Git-SHA vs. Hash der gelesenen Files — Empfehlung: Hash der tatsächlich gelesenen Files (granularer, weniger Cache-Misses).
9. **ADR-009:** A2A-Vorbereitung — welches Interface ist die Soll-Bruchstelle? — Empfehlung: `Scheduler.dispatch(task)` ist der Punkt, an dem später Remote-Worker einsteckbar sind.

---

## 12. Risiken & V1-Vereinfachungen

| Risiko                                           | Mitigation in V1                                                  |
|--------------------------------------------------|-------------------------------------------------------------------|
| LLM-Provider-Lock-in trotz Port                  | Zweiter Adapter spätestens Phase 3, Contract-Tests gegen Port     |
| Plan-Qualität schwankt → teure Re-Plans          | Review-Gate mit max-Iterationen, Telemetrie für Re-Plan-Rate      |
| Token-Explosion durch zu großen Kontext          | Repo-Indexer mit Top-K, Hard-Cap pro Stage                        |
| Cache-Bugs liefern stale Outputs                 | `--fresh` Flag, Cache-Key inkl. Modell-Version, Cache-Audits      |
| Parallel-Scheduler verschleiert Determinismus    | V1 default sequential; parallel nur opt-in mit Warnung im Log     |
| MCP-Komplexität saugt Roadmap ein                | MCP erst V1.5, Domain bleibt MCP-frei                             |
| A2A-Verlockung („machen wir gleich richtig")     | V1 Single-Process, nur Scheduler-Interface stable halten          |
| Logs werden zu groß                              | JSONL-Rotation pro Run, alte Runs in `.kiwi/runs/<runId>/archive` |
| Verteilte Halbwahrheiten in Doku vs. Code        | ADRs canonical, README verweist; Stage-Prompts versioniert        |

V1-Vereinfachungen, die wir bewusst akzeptieren:

- Kein Web-UI / TUI.
- Kein Remote-Worker (A2A nur als Interface).
- Kein eigener Embedding-Service — Repo-Index nutzt Provider-Embeddings oder lokales `transformers.js`.
- Keine Multi-User-Features.
- Keine Plugin-API für Stages (Stages sind in V1 Code).

---

## 13. Wie die 7 Ziele konkret erfüllt sind

| Ziel | Erfüllt durch (V1) |
|------|--------------------|
| 1 — Code-Qualität | Hexagonal/DDD, strict TS, Ports überall, ADRs, Vitest mit Contract-Tests gegen Ports. |
| 2 — Kosteneffizienz | Tier-basiertes Routing, Semantic-Cache, Budget-Guard, Token-Hygiene via Repo-Indexer, Telemetrie pro Stage. |
| 3 — Ease-of-Use | Drei UX-Stufen, `kiwi init`/`doctor`, Defaults sicher, `--dry-run`, sprechende Fehler. |
| 4 — Pipeline | Stages als pure Funktionen, TaskGraph + Scheduler (seq/parallel), Re-Plan-Loop. |
| 5 — High-end für Plan/Review | Stage-Tier-Mapping als Architekturentscheidung, nicht Prompt-Detail. |
| 6 — Transparenz | Event-Log (Source of Truth), Cost-Ledger, `kiwi cost`/`logs`/`explain`, Run-Bundles. |
| 7 — Developer-UX | TTY + JSON Modi, `--verbose`, strukturierte Fehler, Run-Bundles für Audit, drei Komplexitätsstufen. |

---

## 14. Nächste Schritte (vor erstem Code)

1. **Bestätigen:** Stimmen die Tier-Defaults aus §4.1 und der Phasenschnitt aus §10?
2. **Entscheiden:** ADR-001 bis ADR-005 mit kurzer Begründung fixieren (kann Claude vorbereiten — als ADR-Drafts, nicht als Code).
3. **Skizzieren:** Ein konkretes Beispiel-Ticket („Hello-World-Refactor") + erwartetes Run-Bundle als Zielbild — damit Phase 1 ein scharfes Ende hat.
4. **Erst dann:** Phase 0 starten.
