# Code Review: `apps/mcp-server` (+ angrenzende core/runtime-Pfade)

Stand: 2026-05-18 · Reviewer: Cowork-Agent · Scope: `apps/mcp-server/src` plus direkt aufgerufene Pfade in `packages/core`, `packages/runtime`, `packages/ops`, `packages/adapters`. Priorität laut Briefing: **Toter / unnötiger Code → Bugs/Regressionen → Backwards-Compat-Ballast**, UX nur am Rand. Zeilenangaben relativ zum gereviewten Stand.

---

## 1. Bugs & Regressionen

### 1.1 `kiwi_run` re-executiert bereits abgeschlossene Steps — **beide** Branches
`apps/mcp-server/src/run-tools.ts:503–558` zusammen mit `packages/runtime/src/parallel-scheduler.ts:172–211`

Im Non-Sub-Plan-Pfad:

```ts
const selectedSteps = taskGraph.steps.slice(startIndex);
for (const [index, step] of selectedSteps.entries()) {
  steps.push(await runStepToolUnlocked({...stepId: step.stepId...}));
  …
}
```

Im Sub-Plan-Pfad steckt `prepareSubPlans` **alle** selektierten Step-IDs in `pendingStepIds`. `completedHistorically` (`parallel-scheduler.ts:89, 116`) wird nur genutzt, um *Dependencies außerhalb* des selektierten Bereichs als erfüllt zu betrachten — der selektierte Step selbst wird trotzdem neu angefasst. `assertStepDependenciesCompleted` (`packages/core/src/lifecycle/evidence-collection.ts:220`) prüft ebenfalls nur `dependsOn`, nicht ob der Step selbst schon completed ist.

Ergebnis: Nach einem partiellen Run (z. B. drei von fünf Steps grün, Step 4 failed) erstellt der User einen frischen Preview, `kiwi_run` läuft mit dem neuen Token — und führt Steps 1–3 **erneut** aus, statt bei Step 4 weiterzumachen. Es entstehen neue Attempt-IDs/Diffs für identische Arbeit, der TaskGraph-Hash bleibt aber gleich, also passt der Token. **Empfehlung:** zentral in `runStepToolUnlocked` (oder bereits beim Aufbau des `previewStepIds`) per `latestAttemptByStep(...).get(stepId)?.attempt.status === completed` skippen und die Skipped-Schritte als "skipped (already completed)" ins Result reporten. Das fixt beide Branches in einem Patch.

### 1.2 `runTool`: unreachable `throw new Error("Step not found …")` ohne Recovery
`apps/mcp-server/src/run-tools.ts:533–535`

```ts
const startIndex = fromStep ? taskGraph.steps.findIndex(...) : 0;
if (startIndex < 0) {
  throw new Error(`Step not found: ${fromStep}`);
}
```

Durch die Preview-Token-Validierung (Bindung an TaskGraph-Hash + `fromStep`) ist dieser Fall faktisch unerreichbar — aber wenn er doch eintritt (Datenkorruption, manueller `previews/*.json`-Edit), wird ein nackter `Error` geworfen und endet als JSON-RPC `-32000` ohne `data.recovery`. Inkonsistent zum restlichen Tool-Code, der `ToolActionRequiredError` mit `recommendedToolCall` nutzt. Sollte entweder zu `rejectStale(...)` werden oder, besser, zusammen mit Findung 1.1 ganz wegfallen.

### 1.3 `"needs_approval"` als Magic-String statt `RunStatuses.NeedsApproval`
`apps/mcp-server/src/run-tools.ts:555` und `apps/mcp-server/src/next-action.ts:74`

Die Datei importiert bereits `ContractValues` / `RiskProfiles`. `RunStatuses.NeedsApproval` (`packages/contracts/src/common.ts:169`) existiert seit dem aktuellen Refactor. Beide Stellen verwenden den String-Literal stattdessen. Kein Bug heute, aber genau die Art von Drift, die regressiert, sobald jemand den String migriert.

### 1.4 Approval-Hint in `tool-definitions.ts` wird **nicht** durchgesetzt
`apps/mcp-server/src/tool-definitions.ts:214` vs. `packages/core/src/lifecycle/approval.ts:8–29`

Die Tool-Description verspricht:
> "the placeholder 'mcp-operator' is not accepted"

Das Zod-Schema (`tool-input-schemas.ts:64–68`) prüft nur `z.string().min(1)`. `recordApprovalDecision` setzt `approvedBy: params.approvedBy ?? "local-operator"` — auch ein Default-Placeholder. Heißt: ein Client kann `approvedBy: "mcp-operator"` (oder sonst beliebigen unbrauchbaren String) übergeben und bekommt ein gültiges, signiertes Approval-Artefakt. Das ist sicherheits- und audit-relevant.

**Fix:** Im Zod-Schema (`tool-input-schemas.ts`) den Wert per `.refine` blocken oder im `recordMcpApproval` (`core-tool-dispatch.ts:120`) eine Denyliste prüfen, bevor der Aufruf an `recordApprovalDecision` weitergegeben wird. Alternativ: in der Description die Behauptung streichen — sie ist sonst aktiv irreführend.

### 1.5 Resource-Reads liefern `-32000` statt MCP-spezifischer Codes
`apps/mcp-server/src/resources.ts:159, 169` + `apps/mcp-server/src/protocol.ts:146–153`

Wenn ein Artefakt nicht existiert, wird `new Error("Artifact not found: …")` geworfen. Der zentrale `catch` in `handleMcpRequest` mappt das zu `-32000 server error`. MCP-Clients erwarten typischerweise `-32002 resource not found` oder ähnliches semantisches Signal. Das ist eine UX-Regression gegenüber den `ToolActionRequiredError`-Pfaden, die strukturierte `data.recovery` liefern. Vorschlag: eigene Fehlerklasse + Mapping ergänzen, analog `ToolActionRequiredError`.

### 1.6 `latestValidPreviewToken` nutzt einen Preview-Token-Pool ohne Cleanup
`apps/mcp-server/src/preview-tokens.ts:268–315` + `133–171`

Tokens werden als `previews/<token>.json` per Run abgelegt und nie gepruned. Über die Lebenszeit eines Runs sammeln sich mit jedem `kiwi_preview_run` neue Dateien an, `latestValidPreviewToken` macht jedes Mal einen `readdirSync`. Das ist primär ein Disk-/IO-Schluckauf, aber bei langlebigen Runs auch ein potentieller "Replay-Bag": ein historischer Token bleibt valide, solange `stateHash` matched (nichts an HEAD / dirty state / policy hat sich geändert). `appendAuditEvent({ eventType: "mcp_preview_consumed" })` (Z. 251) wird nur appended, der Token wird nicht gelöscht oder als "consumed" markiert. Wenn jemand zwischen zwei `kiwi_run`-Calls den State wieder zurückrollt, könnte er denselben Token mehrfach verwenden. **Empfehlung:** entweder Single-Use (Token-Datei nach erstem `validateMcpPreviewToken` umbenennen/löschen), oder mind. eine Retention-Policy (top-N neueste behalten).

### 1.7 `runTool` rebuilt den Preview pro Step für reine Display-Zwecke
`apps/mcp-server/src/run-tools.ts:313–334`

```ts
const preview = mcpServices.runtime.execution.previews
  .build({ cwd: workspacePath, runId })
  .steps.find((step) => step.stepId === stepId);
```

Für N Steps wird N × der komplette Preview neu gebaut (Policy, Registry, RunnerSelector, SchedulerDecisionService …). Funktional korrekt, aber teuer und nicht trivial — `preview-builder.ts:53` triggert pro Step einen `StepExecutionSession`. Vorschlag: Preview einmal vor der Schleife laden und das `RunExecutionPreview`-Objekt durchreichen (es ist ohnehin schon im PreviewToken-Record als `previewStepIds` referenziert; die volle Liste kann gleich mitgespeichert werden, falls Caller sie braucht).

### 1.8 `_meta.progressToken === null` wird leise verworfen, aber `tools/list` deklariert kein Progress-Capability
`apps/mcp-server/src/protocol.ts:28–66`

`progressTokenFor` akzeptiert nur `string | number`; ein expliziter `null`-Token verschwindet ohne Hinweis. Tests (`mcp.test.ts:716`) belegen das als gewünschtes Verhalten. Allerdings deklariert `initialize` nur `{ resources: {}, tools: {} }` als Capabilities (`protocol.ts:86`). Wenn Server progress-notifications schicken kann (er kann), sollte das auch im Capability-Set stehen — sonst wissen Clients nicht, dass sie `progressToken` mitschicken können. UX-Gap.

---

## 2. Backwards-Compat-Ballast

### 2.1 `streamable-http` ist nur ein Alias für `http` — bringt aber drei volle Codepfade mit
`apps/mcp-server/src/constants.ts:1–13`, `bootstrap.ts:33–41, 82–90`

```ts
McpTransportNames = { Stdio: "stdio", Http: "http", StreamableHttp: "streamable-http" }
```

In `McpServerBootstrap.start()`:
```ts
if (this.options.transport === McpTransportNames.Stdio) { startStdio(...); return; }
this.transports.startHttp(this.options.http);    // <- alles andere
```

Beide Werte fallen in denselben `startHttpMcpServer`. Die Unterscheidung lebt nur in `MCP_TRANSPORT_NAME_VALUES`, der Enum und den entsprechenden Bootstrap-Tests (`mcp.test.ts:187–202`). Entweder echte Streamable-HTTP-Semantik (Sessions, SSE-Streams als Erstklasse) implementieren oder den Alias entfernen — momentan kostet er zwei Tests, drei Enum-Einträge und gibt Usern das falsche Signal, hier wäre ein Unterschied.

### 2.2 `repo-state.ts` ist eine reine Aliase-Datei
`apps/mcp-server/src/repo-state.ts` (5 Zeilen):

```ts
import { readExecutionRepoState, type ExecutionRepoState } from "@kiwi/runtime";
type McpRepoState = ExecutionRepoState;
export function readRepoState(repoPath: string): McpRepoState { return readExecutionRepoState(repoPath); }
```

`McpRepoState` ist als lokaler Typ nicht exportiert (= dead). `readRepoState` ist ein 1:1-Wrapper. Drei Callsites (`doctor.ts:12`, `operator-card.ts:4`, `preview-tokens.ts:16`) könnten direkt aus `@kiwi/runtime` importieren. Die Datei kann komplett gelöscht werden.

### 2.3 Doppelte Status-Konstanten: `McpToolProgressStatuses` vs. `ContractValues`
`apps/mcp-server/src/constants.ts:15–18`

```ts
McpToolProgressStatuses = { Started: "started", Selected: "selected" }
```

Daneben wird `ContractValues.Running / Completed / Failed` für phase-Status genutzt. Insgesamt vier Status-Konstanten in zwei Quellen für dieselbe Achse. Entweder die beiden MCP-only-Werte in `ContractValues` ziehen oder einen einheitlichen `PhaseStatus` machen. Heute fördert die Trennung Inkonsistenzen.

### 2.4 `TOOLS` (named export) ist neben `listTools()` redundant
`apps/mcp-server/src/tool-definitions.ts:378–386`

```ts
export const TOOLS = TOOL_SPECS.map(...);
export function listTools(): typeof TOOLS { return TOOLS; }
```

`TOOLS` wird (nach Grep) nirgendwo direkt importiert; nur `listTools()` ist in Gebrauch (`protocol.ts:102`). Den `TOOLS`-Export entfernen oder die Funktion entfernen — beides nebeneinander ist API-Schwund.

### 2.5 `index.ts`-Re-Exports werden teils nur intern genutzt
`apps/mcp-server/src/index.ts`

- `parsePort` — nur in `bootstrap.ts` und `http.ts` selbst aufgerufen, kein externer Konsument, aber aus index.ts exportiert.
- `type McpServerBootstrapConfig`, `type McpBootstrapOptions` — werden ausschließlich vom Modul selbst und den eigenen Tests verwendet.
- `JsonRpcRequest`/`JsonRpcResponse` aus `json-rpc.ts` — nicht in Tests/Konsumenten verwendet, kann zur public API werden, falls bewusst gewollt, oder gestrichen.

Empfehlung: index.ts auf das wirklich extern Benötigte einkürzen (`handleMcpRequest`, `handleMcpMessage`, `defaultServerCwd`, `startMcpServer`, `startHttpMcpServer`, `McpServerBootstrap`, `resolveMcpBootstrapOptions`).

### 2.6 Doppel-Wrapper über `core`/`runtime`-Services
`apps/mcp-server/src/services.ts` exportiert `createMcpServerServices`, hält ein Modul-Singleton in `mcpServerServices`, und stellt `getMcpServerServices()` zur Verfügung. Dieses Singleton-Pattern bedeutet: Services werden bereits beim Import von `core-tool-dispatch.ts`, `run-tools.ts`, `publish-tool.ts` evaluiert. Mehrere Module rufen `getMcpServerServices()` einmal auf Modulebene auf (`const mcpServices = getMcpServerServices();`) — d.h. `createCoreServices()` und `createRuntimeServices()` laufen beim ersten Import, nicht erst beim Request. Das ist okay für stdio-Server, problematisch beim Testing (siehe `KIWI_FORCE_ACCESS_MODE=stub` in `package.json:test`), weil Env-Vars zum Import-Zeitpunkt schon gesetzt sein müssen. Klar saubererer Pfad: Services lazy beziehen (z. B. `lazy(() => …)` oder DI über `handleMcpRequest`-Context). Das ist ein architekturschuldiger Backwards-Compat-Hack.

---

## 3. Toter / unnötiger Code

### 3.1 Nicht-Top-Level-genutzte Helpers
- `apps/mcp-server/src/tool-helpers.ts:48` `errorMessage` ist trivial (`error instanceof Error ? error.message : String(error)`). Wird einmal in `run-tools.ts:366` aufgerufen. Inline möglich; oder als gemeinsame Util in `tool-helpers` belassen — dann sicherstellen, dass das die einzige Quelle bleibt (siehe `doctor.ts:22` `errorText` macht exakt dasselbe lokal).
- `apps/mcp-server/src/doctor.ts:22` `errorText` ist ein **zweites lokales Duplikat** von `errorMessage`. Sollte gegen die zentrale Variante ersetzt werden.

### 3.2 `McpRepoState` Type-Alias
`apps/mcp-server/src/repo-state.ts:3` `type McpRepoState = ExecutionRepoState;` — nirgends exportiert, nirgends benutzt. Tot.

### 3.3 Dead-Branch in `runTool` (siehe 1.2)
Der `if (startIndex < 0)` Branch ist unreachable. Entweder removen oder durch eine sauber dokumentierte Defensiv-Variante mit `ToolActionRequiredError` ersetzen.

### 3.4 `uniqueSorted` wird nur 2× verwendet
`apps/mcp-server/src/ux.ts:113–115` und genutzt in `operator-card.ts:84, 93`. Klein, aber: `Array.from(new Set(values)).sort()` ist so kurz, dass die Indirektion mehr kostet als sie spart. Subjektiv; kann bleiben, wenn ihr eine konsequente Helper-Linie wollt.

### 3.5 `resourceLinks` exportiert eine fixe Tabelle, die in nur einer Stelle konsumiert wird
`apps/mcp-server/src/ux.ts:102` → einzige Verwendung in `operator-card.ts:94`. Kein Wiederverwendungsgrund — könnte als private Funktion in `operator-card.ts` leben. Schmaleres `ux.ts`.

### 3.6 `MCP_TRANSPORT_NAME_VALUES` als laufzeit-Array
`apps/mcp-server/src/constants.ts:7–11`: das `as const`-Array dient nur einem `.includes`-Check in `bootstrap.ts:36`. Mit `Object.values(McpTransportNames)` direkt benutzbar, eine Konstante weniger. Siehe auch 2.1.

### 3.7 `commandOverrideProperty` Description mehrfach redundant
`apps/mcp-server/src/tool-definitions.ts:41–45` definiert die Description einmal — das ist korrekt DRY. Allerdings duplizieren mehrere Tool-Descriptions denselben Disclaimer (`NO_AUTO_COMMIT_NOTE`) und die UX-Frontmatter (`READ_ONLY.`, `MUTATES_WORKTREE.`). Wirkt für die Modell-Konsumenten redundant. Vorschlag: ein einheitliches Beschreibungsformat-Format in einer Helper-Funktion (`describeTool({ risk, when, requires, returns, next })`) und damit den Description-String generieren. Hält die ~70 verschachtelten Sätze pro Datei beieinander.

---

## 4. UX-Gaps (auf Wunsch knapp gehalten)

- **`tool-definitions.ts:214`**: Description ↔ Schema ↔ Implementierung weichen für `approvedBy` auseinander (siehe 1.4).
- **`tool-definitions.ts:81–113`** für `kiwi_plan` und `kiwi_run`: Beide haben das `NO_AUTO_COMMIT_NOTE` als Postfix; ist die wichtigste Sicherheitsaussage und steht hinter "operatorCard" am Satzende. Modelle lesen Tool-Descriptions oft greedy von vorn — sicherheitsrelevante Aussagen sollten an den Anfang.
- **`protocol.ts:86`**: capabilities deklarieren weder `prompts: {}` (existieren nicht — ok), aber auch keine `progress` oder `logging`. Clients wissen damit nicht, dass das Server-side `progressToken` unterstützt. Mindestens `{ progress: {}, logging: {} }` (sofern unterstützt) ergänzen.
- **`next-action.ts:43–49`**: Wenn `status === "missing"`, ist die `recommendedToolCall` `kiwi_status` — das wiederholt die fehlschlagende Lookup. Sinnvoller wäre `kiwi_doctor` oder `kiwi_plan` mit dem Hinweis "create a new run".
- **`bootstrap.ts:40`**: Error-Message listet `"stdio, http, streamable-http"` — sobald 2.1 umgesetzt wird, hier mit anpassen.

---

## 5. Empfehlung (kurz)

Reihenfolge nach Aufwand/Wirkung:

1. **1.1**: zentraler "Skip already-completed Steps"-Check in `runStepToolUnlocked` oder im PreviewBuilder. Greift beide Branches, vermeidet zukünftige Duplikat-Attempts. **1.2** + **1.3** als kleine Cleanups mitnehmen.
2. **1.4** als Sicherheitsfix: Denyliste für `approvedBy` im Zod-Schema (`["", "mcp-operator", "local-operator", "operator", "system"]`), Tests in `mcp-ux-safety.test.ts` ergänzen.
3. **2.1** entscheiden: echtes Streamable-HTTP oder Alias raus. Im README ist `type: "http"` dokumentiert — Alias hat keine Lebensberechtigung.
4. **2.2** + **3.1** + **3.2**: `repo-state.ts` löschen, `errorMessage` zentralisieren — pure Aufräumarbeiten, niedriger Aufwand, klares Diff.
5. **1.6**: Token-Lifecycle festziehen (Single-Use oder Top-N-Retention), gleichzeitiger Audit-Eintrag `mcp_preview_invalidated`.
6. **1.7**: Preview einmal bauen, Resultat durchreichen — quick win für Wall-Clock-Zeit pro `kiwi_run`.
7. **2.6**: Services lazy initialisieren. Test-Setup wird damit weniger fragil und Modul-Imports werden seiteneffektfrei.

Restliches sind Hygiene-Items, gut für eine "tech-debt"-Pull-Request-Kette in 2–3 kleinen Schritten.
