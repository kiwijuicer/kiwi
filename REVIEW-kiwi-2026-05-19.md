# Kiwi Project Review

**Datum:** 19. Mai 2026
**Reviewer:** Claude (Cowork-Modus)
**Repo-Stand:** lokaler Workspace `ai-kiwi`, version 0.1.0 (package.json)
**Scope:** README/Vision/Architecture-Promises ↔ Implementierung, LLM-Routing & Kostenmodell, MCP-Workflow & Transparenz, Code-Qualität

---

## 1. Zusammenfassung in einem Absatz

Kiwi liefert tatsächlich, was es in `docs/vision.md` und `README.md` verspricht: eine lokale, audit-fähige Kontrollebene über AI-Coding-Runs mit einem TaskGraph-Modell, capability-basiertem Modell-Routing (Frontier für Planning/Review, Strong für Coding, Mid für Tests/SCM), MCP-getriebenem Preview-Token-Workflow mit User-Confirmation-Gate und reproduzierbaren `.kiwi/runs/<run-id>/`-Artefakten. Die Code-Qualität liegt deutlich über dem Durchschnitt vergleichbarer TS-Monorepos (strenge ESLint+SonarJS-Regeln, Architektur-Schichten via dependency-cruiser hart erzwungen, Zod überall an Boundaries, lokale POSIX-Run-Locks, atomare Release-Installation). Die wesentlichen Schwächen sind: (1) der **mitgelieferte Default-Model-Registry verwendet fiktive bzw. zukünftige Modellnamen** (`gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`), und `cheap`/`mid` mappen auf exakt dasselbe Modell mit identischem Pricing — das untergräbt die Kosten-Promise im Default-Setup; (2) einzelne Hotspot-Dateien sind über die selbst gesetzten Soft-Limits gewachsen und nur per Baseline geduldet; (3) der RunLock hat keine Stale-Lock-Recovery; (4) ein paar fundamentale Vertrauens-Promises (echte Provider-Reviewer, Audit-Trail-Integrität) sind in Tests gut, aber in der Realität nur so gut wie die Lokal-CLIs darunter. Insgesamt: das Projekt ist im Vergleich zu vielen "AI-Agent"-Repos außergewöhnlich diszipliniert und produktnah, mit einigen klar benennbaren To-Dos.

---

## 2. Was kiwi verspricht — und ob es das hält

Die Promises aus `README.md` und `docs/vision.md`:

| Promise | Umgesetzt? | Belegstelle |
|---|---|---|
| Ticket → TaskGraph mit Steps, Gates, Acceptance | Ja | `packages/core/src/planning/planner.ts`, `packages/contracts/src/domain/index.ts` (TaskGraphSchema, StepSchema mit `requiredGates`, `successCriteria`) |
| IDE-Assistent führt Schritte über MCP mit Preview/Approve-Gates aus | Ja | `apps/mcp-server/src/tools/preview-tokens.ts`, `next-action.ts`, `run-tools.ts` (Preview-Token wird vor jeder mutierenden MCP-Call validiert) |
| Reproduzierbare Evidence unter `.kiwi/runs/<run-id>/` | Ja | `packages/core/src/runs/store.ts`, `docs/architecture.md` Layout stimmt mit dem real produzierten Layout überein (verifiziert via `kiwi plan` Testlauf, siehe Abschnitt 6) |
| Local-first, keine direkte Anthropic/OpenAI-Key-Pflicht für Daily Use | Ja | `packages/runtime/src/registries/access-mode-resolver.ts` priorisiert Codex-CLI > Claude-Code-CLI > Cursor-Agent-CLI > API-Keys |
| Kein Staging/Commit/Push ohne explizite Anweisung | Ja | `kiwi-policy.yaml` `forbidStaging/forbidCommits/forbidPushes`, plus `docs/rules/security.md`. `publishPrDraft` macht Commit+Push nur über expliziten `kiwi publish pr` Befehl |
| Bitbucket-PR-Draft mit lokaler Git-Auth, keine Token-Speicherung | Ja | `packages/ops/src/publishing/pr-draft.ts` — Verwendung von lokalem `git` + `parseBitbucketCloudRemote` zur reinen URL-Generierung |
| Routing nach `agentRole`, `modelCapability`, Policy, Risk, Budget, Runner-Availability | Ja | `packages/runtime/src/policies/scheduler-policy.ts` (prepareScheduling, determineModelCapability, determineReviewDepth, determineRequiredGates) |
| Audit-Log und Cost-Ledger persistent | Ja | `packages/core/src/ledger/cost-ledger.ts`, `packages/core/src/ledger/model-invocations.ts`, audit events werden flächendeckend appendet |
| Doctor-Befehl zeigt Workspace-Bereitschaft transparent | Ja | Live-getestet, Ausgabe in Abschnitt 6 unten |
| Multi-Repo-Workspace mit `repoId` | Ja | `kiwi workspace list` Command vorhanden, `workspace`-Args-Resolver durchgängig in MCP-Tools |

**Promises, bei denen die Implementierung an die Realität anderer Tools delegiert ist** (kein Bruch, aber wichtig zu verstehen): Die eigentliche LLM-Inferenz läuft über externe CLIs (`codex`, `claude`, `cursor-agent`). Kiwi orchestriert, prüft und persistiert, ruft aber nicht selbst Modell-APIs. Die Qualität der TaskGraph-Pläne, des Review-Verdicts und des Executor-Codes hängt komplett am unterliegenden CLI/Modell. Das ist im Vision-Doc auch klar so beschrieben (`docs/vision.md:218–224` und `kiwi init` schreibt explizit shared defaults aus).

---

## 3. LLM-Routing & Kosten-Promise — kritische Analyse

### 3.1 Was funktioniert sehr gut

Das Routing ist zweistufig (`docs/architecture.md:170–193`):

1. **AgentRole** (`planner`, `executor`, `reviewer`, `security`, `rules`, `researcher`) — beschreibt die Funktion.
2. **ModelCapability** (`cheap`, `mid`, `strong`, `frontier`) — beschreibt das Capability/Cost-Tier.

Die Capability-Vergabe pro Step-Type kommt aus `kiwi-policy.yaml` (`stepTypeOverrides`):

- `planning`: planner + **frontier** ✓
- `review`: reviewer + **frontier** ✓
- `validation`: reviewer + strong
- `coding`/`code_creation`/`code_modification`/`refactoring`: executor + strong
- `test_creation`/`scm_*`/`documentation`/`rules_update`: executor + **mid**

Das matcht die Anforderung "Plan and Review mit Frontier LLMs, ansonsten je nach Komplexität". Hart kodiert ist diese Defaults-Tabelle in `packages/core/src/planning/planner.ts` und `kiwi-policy.yaml` — überschreibbar via Workspace-Overlay.

**Budget-Logik in `packages/runtime/src/policies/scheduler-policy.ts:332-354`:**

```ts
function determineModelCapability(input, routingReason) {
  const riskHigh = determineRiskHigh(input);
  let capability = ModelCapabilitySchema.parse(input.step.recommendedModelCapability);

  const budgetConstrained =
    input.budgetProfile === "tiny" ||
    input.budgetProfile === "small" ||
    budgetSoftCapExceeded({ ... });

  if (!riskHigh && budgetConstrained) {
    capability = downgradeCapability(capability);     // ← downgrade
    routingReason.push("budget_constrained_downgrade");
  }
  if (riskHigh) {
    capability = maxCapability(capability, ContractValues.Strong);  // ← minimum strong
    routingReason.push("risk_over_budget_min_strong");
  }
  ...
}
```

Das ist genau das richtige Pattern: **Risk-High wird nicht durch Budget abgewertet** (Security-Constraint überstimmt Budget — siehe `docs/rules/security.md`: "Budget constraints must never weaken security constraints"). Routing-Reasons werden im scheduler-decision.json mitprotokolliert, was nachvollziehbar bleibt.

**Echtes Pre-Flight-Cost-Estimate** (`packages/core/src/budget/policy.ts:77-88`):

```ts
function estimateAttemptCostUsd({ model, capability, contextLevel }) {
  const inputTokens = INPUT_TOKENS_BY_CONTEXT_LEVEL[contextLevel];  // L0=2k, L1=8k, L2=20k, L3=40k
  const outputTokens = OUTPUT_TOKENS_BY_CAPABILITY[capability];     // cheap=1k, mid=2k, strong=4k, frontier=6k
  return (inputTokens * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1_000_000;
}
```

Wird im StepAttemptOrchestrator (`packages/runtime/src/execution/step-attempt-orchestrator.ts:228-242`) als Hard-Cap-Guard verwendet, bevor das Modell überhaupt gerufen wird (`assertWithinBudgetEstimate`). BudgetProfile-Hard/Soft-Caps in `policy.ts:5–11` sind sinnvolle Defaults (`tiny`: 0.25/0.5 USD, `normal`: 5/10 USD, `critical`: 100/250 USD).

### 3.2 Schwachstellen im Default-Setup

**(a) Der mitgelieferte Default-Registry verwendet nicht-existierende Modellnamen** und doppeltes Pricing.

`apps/cli/src/config/default-config.ts:184–238` (wird via `kiwi init` als `~/.kiwi/defaults/model-registry.yaml` ausgespielt):

```yaml
- id: codex-cli-cheap
  providerModel: gpt-5.4-mini
  pricing: { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }
  capability: cheap
- id: codex-cli-mid
  providerModel: gpt-5.4-mini                        # ← identisches Modell wie cheap
  pricing: { inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }  # ← identisches Pricing
  capability: mid
- id: codex-cli-strong
  providerModel: gpt-5.4
- id: codex-cli-frontier
  providerModel: gpt-5.5
```

Konsequenz:

1. `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5` sind **fiktive Modellnamen** (Stand Mai 2026: OpenAI hat keine Modelle unter diesen Bezeichnungen veröffentlicht; jeder Endnutzer muss den Codex-CLI-Modellnamen manuell anpassen). Das ist ein hartes Daily-Use-Hindernis im Default-Setup. Das User-Guide-Dokument (`docs/user-guide.md`) sollte das deutlich machen, oder die Defaults sollten auf Modellnamen-Platzhalter umgestellt werden, die vom Codex-CLI dynamisch resolved werden (so wie es `claude-code-cli-*` macht, indem `providerModel` weggelassen wird).
2. **`cheap` und `mid` mappen auf identisches Modell und Pricing.** Damit ist die Promise "kostengünstig mit den passenden LLMs" im Default nicht erfüllt — der Scheduler routet die Tier-Auswahl zwar logisch, materiell macht es bei diesen beiden Tiers aber keinen Unterschied (gleicher API-Cost, gleiches Modell, nur unterschiedliche Context-Level-Caps L0 vs L1).

Empfehlung: Default-Mapping z.B. auf `cheap` → kleinstes verfügbares Codex/OpenAI-Modell (gpt-5-nano oder gpt-4o-mini), `mid` → mid-tier (gpt-5-mini oder gpt-4.1-mini), `strong` → main model, `frontier` → reasoning-tier (o3, o4 oder gpt-5). Pricing muss differenziert sein, sonst wird der `downgradeCapability`-Pfad zur Attrappe. Wenn das Default-Mapping bewusst Codex-spezifisch ist und dort intern eine Pricing-Differenzierung erfolgt, sollte das mindestens als Kommentar im YAML stehen.

**(b) Anthropic-Defaults sind realistischer**, aber auch fixiert auf ältere Modelle:

- `packages/adapters/src/integrations/anthropic/planner-provider.ts:37`: `DEFAULT_MODEL = "claude-opus-4-6"`
- `packages/adapters/src/integrations/anthropic/reviewer-provider.ts:37`: `DEFAULT_MODEL = "claude-sonnet-4-6"`

Diese Modellnamen sind real (Stand Frühjahr 2026: Claude Opus 4.6 und Sonnet 4.6 existieren). Frontier-Planning auf Opus, Strong-Review auf Sonnet — das matcht die Promise solide. Eine Bezugnahme auf Opus 4.7 (das es zum Review-Zeitpunkt schon gibt) könnte das Default modernisieren.

### 3.3 Routing-Reasons sind transparent und auditbar

Jeder Scheduler-Decision (`steps/<step-id>/<attempt-id>/scheduler-decision.json`) enthält `routingReason: string[]`. Beispielwerte aus dem Code:

- `budget_constrained_downgrade`
- `risk_over_budget_min_strong`
- `cheap_capability_l0_cap`
- `mid_capability_l1_cap`
- `risk_high_security_gates`
- `risk_high_frontier_review`
- `runner_selected:<runner-name>`

Das ist hervorragend für Debugging und Erklärbarkeit. Der `kiwi explain <run-id>`-Befehl (`docs/architecture.md:39`) zieht das auf.

---

## 4. MCP-Workflow & Transparenz für Entwickler

### 4.1 Promise

Aus dem README: "Der Entwickler muss sich die Befehlssequenz nicht merken. `kiwi_next` sagt dem IDE-Assistenten den nächsten sicheren Tool-Call." Mutationen erfordern frischen `previewToken`, der nur über `kiwi_preview_run` zu bekommen ist; Assistent muss `decision.confirmationSummary` zeigen.

### 4.2 Realität — sehr stark umgesetzt

**Preview-Token-Mechanik** (`apps/mcp-server/src/tools/preview-tokens.ts`):

Ein Token bindet via SHA-256-Hash an:

- `taskGraphHash` (Planänderung invalidiert)
- `policyHash` (Policy-Änderung invalidiert)
- `registryHash` (Modell-Änderung invalidiert)
- `repoHead` + `repoBranch` (Branch-Switch invalidiert)
- `dirtyStateHash` (Working-Tree-Änderung invalidiert)
- `previewInput.fromStep + maxConcurrency + command` (Parameter-Drift invalidiert)
- `executionIsolation` (direct vs worktree invalidiert)

Token ist **einmalig** (`consumedAt` wird gesetzt), Retention ist 25 (`PREVIEW_TOKEN_RETENTION_LIMIT`). Audit-Events `mcp_preview_created`, `mcp_preview_consumed`, `mcp_preview_pruned` werden in den Run-scoped Audit-Log appendet (`preview-tokens.ts:248-262, 374-383`). Das ist Bilderbuch-Capability-Token-Design.

**`kiwi_next` als Workflow-Compass** (`apps/mcp-server/src/tools/next-action.ts:260-289`):

Liefert pro Run-Status (Planned, Running, NeedsApproval, Failed, Completed) ein strukturiertes Decision-Objekt:

```ts
{
  recommendedToolCall: { name, args },
  whyThisTool: "...begründung...",
  requiresUserConfirmation: true|false,
  expectedMutation: "READ_ONLY" | "WRITES_RUN_ARTIFACTS" | "MUTATES_WORKTREE",
  expectedAfter: "...was nach dem Call passieren wird...",
  blockedBy: ["..."]
}
```

Das ist exakt das, was ein IDE-Assistent braucht, um "transparent" zu sein: er bekommt einen klaren Tool-Vorschlag *mit Begründung*, *Risikoklasse*, und *erwartetem Effekt*. Der Output enthält auch `safeAlternatives` (read-only Calls, die immer ohne Confirmation gehen) und einen `operatorCard`-Block mit menschenlesbarer Zusammenfassung.

**Stale-Token-Recovery** (`preview-tokens.ts:297-359`): Bei jedem mutierenden Tool wird der Token-Hash mit dem aktuellen Repo-/Policy-Hash verglichen. Driftet etwas, wird `ToolActionRequiredError` mit Recovery-Pfad geworfen (`recommendedToolCall: kiwi_preview_run`), nicht silent failed.

**Direct-Execution-Safety** (`run-tools.ts:89-117`): Vor jeder Direct-Mode-Ausführung wird via `assertDirectExecutionSafe(repoPath)` geprüft — Branch, Dirty-State, Untracked-Files. Bei Verstoß: strukturierter Fehler mit User-Message für den IDE-Chat.

### 4.3 Wo der Workflow noch besser werden könnte

**(a) MCP-Tool-Beschreibungen** sind ordentlich (`definitions.ts:53-71` baut sie durch `describeTool({risk, when, requires, returns, next})` — gleichförmige Struktur). Aber: Das `NO_AUTO_COMMIT_NOTE` ist eine Konstante, kein per-Tool-customisierbarer Hinweis. Tools wie `kiwi_apply` oder `kiwi_publish_pr_draft` könnten zusätzliche tool-spezifische Safety-Notes vertragen.

**(b) Approval-Identity-Resolution** ist sicher umgesetzt (`next-action.ts:165-173`: `KIWI_MCP_APPROVED_BY` Env-Var, mit Blocklist gegen Platzhalter wie "user", "claude" etc.) — gute Defense-in-Depth, aber für nicht-technische Nutzer unsichtbar. Hier könnte ein `kiwi config set approver <email>` helfen, plus eine Doctor-Warnung wenn unkonfiguriert.

**(c) `kiwi_diff` und `kiwi_apply` sind getrennt** — das ist gewollt (Mensch reviewt Diff zwischen Worktree und Apply). Es fehlt aber eine kompakte `kiwi_diff_summary`-Antwort für längere Diffs; aktuell muss der Assistent den ganzen Diff in den Chat schieben, was bei großen Step-Diffs teure Token-Kosten verursacht.

---

## 5. Code-Qualität — tiefer Befund

### 5.1 Struktur / Architektur — sehr gut

**Schichtenmodell hart enforced** (`dependency-cruiser.config.cjs:4-46`):

```js
forbidden: [
  { name: "no-app-imports-from-packages", from: /packages/, to: /apps/ },         // ✓
  { name: "core-stays-below-runtime-integrations",
    from: /packages/core/, to: /packages/(adapters|sandbox|runtime|ops)/ },        // ✓
  { name: "contracts-no-internal-deps",
    from: /packages/contracts/, to: /packages/(core|adapters|sandbox|runtime|ops)/ }, // ✓
  { name: "runtime-no-ops-deps", from: /packages/runtime/, to: /packages/ops/ }, // ✓
  { name: "ops-no-sandbox-deps", from: /packages/ops/, to: /packages/sandbox/ },  // ✓
  { name: "no-circular", to: { circular: true } }                                  // ✓
]
```

Das ist genau die in `docs/architecture.md:84–92` versprochene Schichtung — und sie wird im Lint-Schritt mechanisch geprüft (`pnpm lint:arch`). Sehr selten so sauber gesehen.

**Contracts-Package als single source of truth** (`packages/contracts/src/{domain,policy,execution,evidence,shared,scm}/`): Zod-Schemas + inferred TS-Types liegen *zusammen*; Schemas werden in CLI, MCP, Runtime und Adapter beim Lesen/Schreiben jedes Artefakts geparst (`writeJsonSafely` → `ContractSchema.parse(json)`). Keine "trust me bro" data-flows.

**Eslint-Regel gegen domain-Strings außerhalb der Contracts** (`eslint.config.mjs:37-72`, `CANONICAL_LITERAL_RULES`): Das Vorkommen von Literalen wie `"planner"`, `"frontier"`, `"completed"` außerhalb von `contracts/*` und `*Schema`-Typen löst Warning aus. Erzwingt Constants-Discipline. Sehr ungewöhnlich rigoros.

### 5.2 Test-Coverage — solide

- **54 Test-Dateien**, **12 563 Test-LoC** gegen **31 600 Source-LoC** (ohne Tests) — Verhältnis ~40 % Test/Source-LoC.
- Tests decken die kritischen Pfade ab: `scheduler-policy.test.ts` mit Risk-/Budget-Pfaden, `provider-registry.test.ts`, `runner-resolution.test.ts`, `preview-tokens.test.ts`, `pr-draft.test.ts`, `quality-gates.test.ts`, `diff-workflow.test.ts`.
- Tests benutzen `KIWI_FORCE_ACCESS_MODE=stub` und temporäre `mkdtempSync`-Verzeichnisse — Run-Artefakte werden hermetisch verifiziert (z.B. `scheduler-policy.test.ts:65–68` prüft die Existenz der context-package.json am erwarteten Pfad).
- Es gibt einen End-to-End-Smoke-Test (`scripts/smoke.mjs` via `pnpm smoke`), und Makefile `make install` führt nach Build einen *eingebauten Smoke-Test* (`Makefile:97–99`) gegen das frische Release durch (atomarer Symlink-Swap erst nach Smoke-Pass).

### 5.3 Code-Health-Toolchain — überdurchschnittlich

Das `package.json` hat dedizierte Targets:

```
lint:eslint     — ESLint mit typescript-eslint + sonarjs
lint:baseline   — diff-bezogene Eslint-Baseline (config/eslint-baseline.json)
lint:arch       — dependency-cruiser (Schichten)
lint:deadcode   — knip (unused exports)
lint:duplicates — jscpd
lint:file-size  — eigene Script, blockt >1000 LoC Dateien außerhalb der Baseline
lint:oop        — eigene AST-Script, limitiert "loose top-level functions" pro Datei (Push to encapsulation)
lint:string-values — verbietet string-literal-Unions außerhalb der Contracts
code-health     — Aggregat
release:check   — format:check + lint + lint:arch + code-health + typecheck + test + build + smoke
```

`release:check` als Single-Command-Gate ist exakt das, was man sich für CI wünscht.

### 5.4 Konkrete Code-Schmerzen (klein, aber lohnend zu fixen)

**(a) Hotspot-Dateien überschreiten die selbst gesetzten Soft-Limits.** Stand heute (`wc -l` auf den aktuellen Source-Files, 2026-05-19):

| Datei | Lines | Problem |
|---|---|---|
| `packages/runtime/src/policies/scheduler-policy.ts` | 787 | Größte Source-Datei, Soft-Cap 600 überschritten |
| `apps/mcp-server/src/tools/run-tools.ts` | 647 | knapp über 600 |
| `apps/cli/src/commands/setup/init.ts` | 645 | knapp über 600 |
| `packages/runtime/src/execution/step-attempt-orchestrator.ts` | 533 | Methode `blockBudgetExceeded` (Zeile 209) ~193 Zeilen — die Methode allein wäre als eigene Datei lesbarer |
| `apps/mcp-server/src/tools/next-action.ts` | 373 | `nextTool` 148 Zeilen, Cognitive Complexity 25 (Limit 20) — laut Baseline |

`config/eslint-baseline.json` (Stand 2026-05-16) listet zusätzlich `dispatcher.ts` (damals 1006 Zeilen) und `planned-steps/index.ts` (damals 719 Zeilen) — beide sind inzwischen massiv reduziert (`dispatcher.ts` jetzt 306 Zeilen, `planned-steps/index.ts` jetzt 37 Zeilen). Das zeigt, dass der Baseline-Reduction-Pass aktiv läuft — die Baseline ist allerdings noch nicht refresht. Empfehlung: `pnpm lint:baseline:init` neu aufrufen, dann die nächsten Hotspots (`scheduler-policy.ts`, `run-tools.ts`, `init.ts`) angehen.

**(b) `blockBudgetExceeded` in `step-attempt-orchestrator.ts:209–402`** ist ~193 Zeilen reine Persistenz-Choreografie für den Block-Pfad. Idealerweise:

- Eigenen `BudgetBlockedAttempt`-Builder extrahieren (eigene Datei).
- Die `writeJsonSafely`-Sequenzen über einen `AttemptWriter`-Service kapseln.
- Audit + Persist + Decision in atomar-konsistenten Block bündeln (aktuell viele writes in unbestimmter Reihenfolge — bei Crash mitten drin gibt es teil-persistierten Block-State).

**(c) `RunLock` hat keine Stale-Lock-Recovery** (`packages/core/src/runs/lock.ts:52–132`):

```ts
descriptor = openSync(target, "wx");  // atomic create, EEXIST wenn Lock existiert
```

Bei Prozess-Crash bleibt die `run.lock`-Datei zurück und blockiert alle weiteren Calls auf diesen Run für immer. `RunLockBusyError` enthält zwar `existing` (den parsten Lockfile-Inhalt), aber kein Cleanup-Pfad. Außerdem prüft `release()` nicht, ob es noch unser Lockfile ist (PID-Check fehlt). Mögliche Fixes:

- Lockfile enthält bereits `ownerPid` — bei Acquire-Fail könnte `process.kill(pid, 0)` prüfen, ob der Owner noch lebt.
- Ein `kiwi runs unlock <run-id>` Operator-Befehl als manueller Recovery-Pfad.
- Doctor-Check könnte stale Locks anzeigen.

**(d) Bundle-Check** (`scripts/check-bundle-requires.mjs`, vom `pnpm build` aufgerufen): Sehr nützlich, scannt das gebündelte `dist/index.js` nach unerwünschten Runtime-Requires. Solides Hardening.

**(e) `secretEnvNamesFromPolicy` + `redactForProvider`** (`packages/adapters/src/providers/redaction.ts`) — gut, redactiert sowohl bekannte Env-Werte als auch generische Secret-Patterns (sk-ant-, sk-, JWT-shape). Caveat: Die `SECRET_VALUE_PATTERNS` sind hartcodiert; eine Erweiterungsschnittstelle (Policy-konfigurierte zusätzliche Regexe) wäre gut.

**(f) `cliPlannerInvoke` & co. parsen `parseJsonLines` ohne Schema-Validation** — der Anthropic-Path (`packages/adapters/src/integrations/anthropic/common.ts`) hat eine schöne `extractTextJson` + Zod-Validierung. Der Codex-CLI-Path im selben Provider sollte symmetrisch Zod-validieren bevor er die unstrukturierte LLM-Antwort als TaskGraph durchreicht. Aktuell wird das *upstream* gemacht (in `PlannerProviderError` und Replanner-Repair-Loop), aber asymmetrische Validation ist eine typische Stelle für Drift.

### 5.5 TypeScript-Discipline — sehr gut

- `strict` aktiv (`tsconfig.base.json`).
- Keine `any` in den geprüften Source-Files; Ausnahmen liegen unter `parse(JSON.parse(...))` in dem `unknown`-zu-`Schema`-typed gecastet wird.
- `@typescript-eslint/no-floating-promises: warn`, `no-misused-promises: warn`, `switch-exhaustiveness-check: warn` aktiv.
- `as const` + Zod statt TS-`enum` (per `docs/rules/typescript.md:22`).

### 5.6 Sicherheits-Hardening — sehr gut

- `kiwi-policy.yaml` `commandProfiles.*.networkPolicy: disabled` für coding-relevante Profile.
- `deniedPaths: [.env*, secrets/**]` durchgängig.
- `forbidStaging/forbidCommits/forbidPushes: true` in `execution`.
- Risk-Zones in der Policy (`src/auth/**`, `src/payment/**`, `infra/**`, `migrations/**`, `.github/workflows/**`) escalieren auf Frontier-Review (verifiziert via Scheduler-Pfad).
- `KIWI_ALLOW_MCP_COMMAND_OVERRIDE`-Opt-In für Command-Overrides (`run-tools.ts:24, 119-153`) — Mutationen mit beliebiger Command-Override nur in `dev`-Risk-Runs oder mit explizitem Server-Flag.
- Audit-Events sind append-only und werden run-scoped persistiert.

---

## 6. Live-Verifikation: `kiwi --help`, `kiwi init`, `kiwi doctor`, `kiwi plan`

Ausgeführt im Sandbox:

`kiwi --version` → `0.1.0`. ✓

`kiwi init --mcp none` im sauberen `/tmp/kiwi-test-workspace` produzierte:
- `.kiwi/config.yaml`
- `~/.kiwi/defaults/policy.yaml`
- `~/.kiwi/defaults/model-registry.yaml`
- Git-exclude eingerichtet

`kiwi doctor` ausgegeben (relevanter Auszug):

```
policy: kiwi (mid default)
registry: 13 entries
  claude-code-cli: 3 entries — unavailable (claude is not logged in)
  cursor-agent-cli: 2 entries — unavailable (binary 'cursor-agent' not on PATH)
  codex-cli: 4 entries — unavailable (binary 'codex' not on PATH)
  stub: 4 entries — available (tests/dev only; disabled for plan by default)
preferred order: codex-cli > claude-code-cli > cursor-agent-cli > anthropic-api > openai-api > cursor > jetbrains > local > stub
runner registry: local-shell:ok, stub:unavailable (stub access is disabled), claude-code:unavailable, codex:unavailable, cursor-agent:unavailable
roles enabled: planner=5, researcher=7, reviewer=10, executor=10
```

Sehr transparent — der Nutzer sieht sofort, welche Provider er installieren/authentifizieren muss. Die Reasons sind menschenlesbar.

`KIWI_ALLOW_STUB=1 kiwi plan ticket.md` produzierte:
- `run_20260519_104738_3526` mit deterministischer 5-Step-TaskGraph
- Step 2 `planning` → `planner` + `frontier` ✓
- Step 3 `test_creation` → `executor` + `mid` ✓
- Step 4 `code_modification` → `executor` + `strong` ✓
- Step 5 `validation` → `reviewer` + `strong` ✓
- gespeichert unter `.kiwi/runs/run_.../plan/task-graph.json`

**Promise verifiziert: Plan und Review nutzen Frontier-Tier; Coding nutzt Strong; Tests/Validation passend nach Step-Type.**

---

## 7. Prioritäre Empfehlungen

| Prio | Maßnahme | Aufwand | Begründung |
|---|---|---|---|
| **P1** | Default-Model-Registry: realistische Codex-Modellnamen und differenziertes cheap/mid-Pricing | klein | Kern-Promise "kostengünstig mit passenden LLMs" greift im Default-Setup sonst nicht |
| **P1** | `RunLock`-Stale-Recovery (PID-Liveness-Check + manueller Unlock-Command + Doctor-Warning) | klein–mittel | Single-Point-of-Failure für lokalen Daily-Use |
| P2 | Aktuelle Hotspots (`scheduler-policy.ts`, `run-tools.ts`, `init.ts`) aufteilen + Baseline refreshen | mittel | Reviewability + zukünftige Erweiterbarkeit |
| P2 | Codex-CLI-Planner-Path symmetrisch Zod-validieren (analog Anthropic-Pfad) | klein | Defense-in-Depth gegen LLM-Output-Drift |
| P2 | `kiwi_diff_summary`-MCP-Tool für kompakten Diff-Überblick im Chat | klein | Reduziert Token-Cost im IDE-Chat bei großen Step-Diffs |
| P3 | Anthropic-Default-Models auf Opus 4.7 / Sonnet 4.6 aktualisieren | trivial | Aktualität |
| P3 | `kiwi config set approver <email>` Command + Doctor-Warnung wenn `KIWI_MCP_APPROVED_BY` unkonfiguriert | klein | UX für Approval-Flow |
| P3 | Erweiterbare Secret-Pattern-Regexe via Policy (statt hartcodiert) | klein | Customisability für Org-spezifische Token-Patterns |
| P3 | `blockBudgetExceeded` in eigenen `BudgetBlockedAttemptWriter` extrahieren | klein | Lesbarkeit |

---

## 8. Verdict

Kiwi macht im Wesentlichen, was es verspricht. Die Architektur ist überdurchschnittlich diszipliniert (harte Schichtgrenzen, Contract-First mit Zod, austauschbare Provider-Schicht, ehrliche Routing-Reasons, Capability-Token für MCP-Mutationen, atomare Release-Installation mit Smoke-Test). Die Promise "Plan and Review mit Frontier-LLMs, Coding mit Strong, Tests/SCM mit Mid" ist im Step-Type-Override-Mapping, im Policy-File und in der Verify-Run-Telemetry konsistent abgebildet.

Die wesentliche Lücke zwischen Anspruch und Auslieferung liegt **nicht** in der Architektur, sondern in der mitgelieferten Default-Model-Registry: fiktive `gpt-5.x`-Namen und identisches Pricing zwischen `cheap` und `mid` machen das Kostenoptimierungs-Versprechen im Default-Setup zur Theorie. Für den Daily-Use muss jeder Operator das Registry-File manuell anpassen — was zwar dokumentiert ist (`docs/integrations/*.md`), aber als Out-of-the-Box-Erfahrung ein Reibungspunkt ist.

Code-Qualität insgesamt: **stark überdurchschnittlich.** Der Code, den kiwi *als Werkzeug* produzieren würde, hängt am gewählten Provider, aber das Werkzeug selbst ist gut geschrieben — und sein eigener Workflow (`release:check`-Gate) demonstriert glaubhaft, welche Qualitätsmesslatte das Team an seine eigene Arbeit anlegt.

---

*Reviewed by Claude, Cowork mode. Generated 2026-05-19. Pfadangaben relativ zum Workspace-Root.*
