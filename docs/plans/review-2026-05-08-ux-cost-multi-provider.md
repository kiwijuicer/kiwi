# Review 2026-05-08: UX, Multi-Provider, Cost-Efficiency Plan

Status: PLANNED
Created-Date: 2026-05-08
Milestone: Hardening
Depends-On: -
Vision-Refs: 2.1, 5.3, 7.2, 13, 14.1, 14.2

## Kontext

Review-Auftrag: kiwi soll als CLI und MCP gleichermassen nutzbar sein,
Live-Transparenz bieten, gute UX und Fehler-Handling haben, Aenderungen
nach Ruecksprache wirklich anwenden, mehrere Anbieter (Claude, Cursor,
Codex) ausreizen und Kosten aktiv steuern.

Dieser Plan fasst die Lueckenanalyse zusammen und definiert fuenf
unabhaengige, KISS-konforme Schritte. Reihenfolge nach Hebelwirkung,
nicht nach technischer Abhaengigkeit. Jeder Schritt ist in 1-5 Tagen
umsetzbar und kann separat gemerged werden.

## Zusammenfassung des aktuellen Zustands

Was ist schon vorhanden und sollte erhalten bleiben:

- Saubere Modulgrenzen `contracts -> core -> runtime -> adapters/sandbox -> apps`.
- Persistenz unter `.kiwi/runs/<run-id>/` mit Plan-, Step-, Attempt-,
  Final-Artefakten und Audit-Log.
- `model-registry.yaml` plus `access-mode-resolver.ts` waehlen lokale
  CLI-Logins (`claude`, `codex`, `cursor-agent`) ohne API-Keys.
- `scheduler-policy.ts` kennt Risk, Budget und Capability-Tiers.
- `budget-policy.ts` enthaelt eine Preisliste pro Modell und einen
  Pre-Flight-Guard `assertWithinBudgetEstimate`.
- `kiwi doctor` listet Login-Status, Binaries und Access-Mode-Reihenfolge.
- Worktree-Sandbox in `packages/sandbox/src/worktree.ts` mit
  `git worktree add` plus copy-folder Fallback.
- MCP-Server (stdio + http) mit JSON-RPC und 18 Tools.

## Gefundene Luecken (priorisiert)

1. **MCP ohne Live-Progress.** `apps/mcp-server/src/tools.ts` liefert erst
   nach Abschluss zurueck. `kiwi_plan` und `kiwi_run` blockieren den
   Client minutenlang ohne Rueckmeldung. Es gibt keinen
   `notifications/progress`-Sender im Server.

2. **CLI streamt keinen Modell-Output.** `apps/cli/src/commands/run.ts`
   druckt nur Heartbeat-Zeilen alle 30 s. Step 33 (`kiwi tail` plus
   Streaming) ist `PLANNED`. Die CLI-Adapter
   (`packages/adapters/src/claude-code-cli/client.ts` und Geschwister)
   buffern stdout vollstaendig.

3. **Kein `kiwi diff`.** Es fehlt der zentrale UX-Schritt nach dem Run:
   Patch der angewendeten Aenderungen ansehen, bevor finalize / publish
   laeuft. Der `materializedDiff`-Pfad in `executePlannedStep`
   persistiert den Diff zwar als Artefakt, aber es gibt keinen Befehl,
   der ihn dem User direkt zeigt. Im opt-in `worktree`-Modus
   (`KIWI_EXECUTION_ISOLATION=worktree`) fehlt zusaetzlich ein
   `kiwi apply`, um den persistierten Patch nach Review aufs Source-Repo
   anzuwenden.

4. **Kosten erst nach dem Run sichtbar.** `kiwi cost <runId>` ist
   post-hoc. `kiwi plan` zeigt keinen Forecast fuer den ganzen
   TaskGraph. `assertWithinBudgetEstimate` wirft erst beim Hard-Cap.
   Es gibt keine Vorab-Anzeige `Estimated total: $X.XX`.

5. **Modellwahl innerhalb eines Tiers ist starr.**
   `selectEnabledModelByAccessMode` in
   `packages/runtime/src/access-mode-resolver.ts` nimmt das erste
   passende Modell. Es gibt keinen Tie-Breaker nach
   Provider-Praeferenz oder Kostenheuristik. Codex und Cursor sind im
   `model-registry.yaml` nur als `executor` registriert, koennen aber
   technisch auch reviewen / planen.

6. **MCP-Tool-Inventar ist zu gross.** 18 Tools, davon 8 fuer A2A. A2A
   ist laut `docs/architecture.md` eingefroren, wird aber trotzdem
   exponiert. Das ist verwirrend und KISS-widrig.

7. **`kiwi status` druckt verschachtelt alles.** Default-Output listet
   alle Artefakt-Pfade, alle Attempts, alle Subplans. Eine kompakte
   Zeile pro Run waere sinnvoller, Details hinter `--verbose`.

8. **Generisches Fehler-Handling.** `register-common.ts:handleCommandError`
   gibt nur die Nachricht zurueck. Step 31 plant Remediation-Hints,
   ist aber noch nicht umgesetzt. Hinweise wie "run `kiwi doctor`"
   oder "run `claude login`" fehlen.

9. **Keine MCP Resources.** Der Server exponiert keine
   `resources/list` und `resources/read` fuer Plan, Diff, Cost-Report,
   Final-Summary. IDE-Clients muessen jeden Inhalt ueber separate
   Tool-Calls holen.

## Plan in fuenf Schritten

Reihenfolge nach Hebelwirkung. 1 + 2 zusammen liefern etwa eine Woche
Aufwand und decken den Grossteil der UX-Verbesserungen ab.

### Schritt 1: MCP Live-Progress und Resources

Eigenes Spec-File: `step-41-mcp-progress-and-resources.md` (anzulegen).

**Ziel.** Jedes lang laufende MCP-Tool sendet Fortschrittsmeldungen,
und alle relevanten Run-Artefakte sind als MCP-Resource lesbar.

**Scope.**

- `apps/mcp-server/src/protocol.ts`: `notifications/progress` als
  JSON-RPC-Notification ergaenzen, getrennt fuer stdio und http
  (Server-Sent Events fuer http).
- Hook `onProgress(message: string, percent?: number)` durch
  `executePlannedStep`, `planRun`, `finalizeRun` durchreichen.
  Dieselben Strings wie der CLI-Heartbeat verwenden, kein neuer
  Wortlaut.
- `apps/mcp-server/src/resources.ts`: `resources/list` mit allen
  Dateien unter `.kiwi/runs/<id>/plan/`, `steps/<id>/<attempt>/artifacts/`
  und `final/` als URIs `kiwi://<run-id>/<rel-path>`.
  `resources/read` liefert Datei-Inhalt mit korrektem Mimetype
  (`application/json`, `text/markdown`, `text/x-diff`).
- Nur die fuenf am haeufigsten gebrauchten Tools senden Progress
  (`kiwi_plan`, `kiwi_run`, `kiwi_run_step`, `kiwi_finalize`,
  `kiwi_publish_pr_draft`).

**Out of scope.**

- TUI, Dashboard.
- Token-Streaming in MCP (nur Phase-Progress; Step 33 deckt CLI-Stream).

**Acceptance.**

- Cursor / Claude Code zeigen waehrend `kiwi_plan` Live-Phasen
  ("planner started", "still planning 30 s", "planner completed").
- `resources/list` liefert nach `kiwi_plan` mindestens den
  `task-graph.json` als URI; `resources/read` gibt Inhalt zurueck.

**Validation.**

- Vitest gegen Mock-Transport, der Progress-Notifications zaehlt.
- Smoke-Test in `scripts/smoke.mjs` ergaenzen.

**Aufwand.** 3-5 Tage.

### Schritt 2: `kiwi diff` und `kiwi apply` (direct bleibt Default)

Eigenes Spec-File: `step-42-diff-and-apply-commands.md`.

**Ziel.** User sieht und kontrolliert den Patch. Der Default-Modus
`direct` bleibt unveraendert (Runner schreibt direkt ins Source-Repo);
der `worktree`-Modus bleibt opt-in via
`KIWI_EXECUTION_ISOLATION=worktree`. Beide Modi bekommen einen
sichtbaren Diff-Workflow.

**Scope.**

- Default-Verhalten **nicht** aendern. `packages/runtime/src/planned-step-execution.ts:39`
  bleibt `direct` als Default. ENV `KIWI_EXECUTION_ISOLATION=worktree`
  bleibt das explizite Opt-In.
- Neuer CLI-Command `kiwi diff <runId> [stepId]` in
  `apps/cli/src/commands/diff.ts`. Liest den persistierten
  `diff.patch` aus `steps/<step>/<attempt>/artifacts/`. Output:
  `git diff --stat` plus voller Patch. Optional `--json` fuer
  maschinenlesbar, `--all` fuer alle Steps des Runs zusammen.
  Funktioniert in beiden Modi: in `direct` zeigt es retrospektiv was
  bereits angewendet wurde, in `worktree` zeigt es den noch nicht
  angewendeten Patch.
- Neuer CLI-Command `kiwi apply <runId> [stepId]` in
  `apps/cli/src/commands/apply.ts`. Nur sinnvoll fuer den
  `worktree`-Modus: macht `git apply --check && git apply` auf das
  Source-Repo, schreibt `attempt_diff_applied` ins Audit, blockiert
  wenn Review-Verdict `needs_changes` oder `reject` ist
  (Override mit `--force-unsafe`). Im `direct`-Modus bricht
  `kiwi apply` mit klarem Hinweis ab, dass der Patch bereits
  angewendet wurde.
- MCP-Tools `kiwi_diff` und `kiwi_apply` mit identischen Argumenten.
- Ergaenzung in `register-execution.ts` und `tool-definitions.ts`.

**Out of scope.**

- Wechsel des Default-Execution-Modus.
- Aendern der Worktree-Strategie selbst (git-worktree vs copy-folder).
- Multi-Step-Apply in einer Transaktion.

**Acceptance.**

- `kiwi diff <id>` zeigt Stat plus Patch fuer den letzten Attempt
  jedes Steps; `--all` fasst zusammen.
- `kiwi diff <id>` funktioniert in beiden Execution-Modi.
- Im `worktree`-Modus wendet `kiwi apply <id>` sauber an,
  idempotent (zweites apply schlaegt mit klarem Hinweis fehl).
- Im `worktree`-Modus blockiert `kiwi apply` bei
  `verdict: needs_changes` ohne `--force-unsafe`.
- Im `direct`-Modus liefert `kiwi apply` Exit-Code 0 mit Hinweis
  "already applied during run".

**Validation.**

- Vitest fuer den neuen Command-Pfad gegen ein temporaeres Git-Repo,
  beide Execution-Modi.
- Smoke: Plan -> Run -> Diff -> (optional Apply) -> Finalize gegen
  Stub-Provider.

**Aufwand.** 2-3 Tage.

### Schritt 3: Cost-Forecast vor dem Run

Eigenes Spec-File: `step-43-cost-forecast-pre-run.md`.

**Ziel.** User sieht vor dem ersten Token, was der Run kostet.

**Scope.**

- `apps/cli/src/commands/plan.ts` ergaenzen: nach erfolgreichem
  TaskGraph fuer jeden Step `estimateAttemptCostUsd` aus
  `packages/core/src/budget-policy.ts` aufrufen, getrennt nach
  Phase (`planner`, `executor`, `reviewer`). Summe ausgeben:
  `estimated cost: $0.42 (planner $0.04 + execution $0.30 + review $0.08)`.
- Im MCP `kiwi_plan`-Result-Object Feld `estimatedCostUsd` und
  Aufschluesselung pro Step.
- Neuer CLI-Flag `kiwi run --max-cost <usd>` (Hard-Cap pro Run).
  Bei Ueberschreitung Abbruch vor erstem Step mit klarem Hinweis,
  welches Budget-Profil mehr erlaubt.
- Nicht-Ziel: dynamische Reschaetzung pro Step zur Laufzeit (das macht
  schon der Pre-Flight-Guard).

**Out of scope.**

- Eigene Preislisten-Konfiguration in YAML (Preise bleiben hartkodiert
  in `priceForModel`).
- Cost-Reports in HTML.

**Acceptance.**

- `kiwi plan` druckt eine Forecast-Zeile.
- `kiwi run --max-cost 0.10` bricht bei einem 0.20-USD-Forecast mit
  Exit-Code 1 ab und nennt `--budget-profile`.
- MCP `kiwi_plan`-Result enthaelt `estimatedCostUsd` als number.

**Validation.**

- Vitest fuer den Forecast-Builder.
- Snapshot des CLI-Outputs.

**Aufwand.** 1-2 Tage.

### Schritt 4: Multi-Provider-Routing erweitern

Eigenes Spec-File: `step-44-multi-provider-routing.md`.

**Ziel.** Best-of-Claude-Codex-Cursor wird konfigurierbar; nicht jeder
Step landet automatisch bei Anthropic.

**Scope.**

- `model-registry.yaml`: Codex und Cursor-Agent zusaetzlich als
  `roles: [executor, reviewer, researcher]` markieren. Capability-Tier
  `strong` bleibt; `mid` als zweiter Eintrag fuer Codex/Cursor
  ergaenzen, falls ein guenstigerer Modus verfuegbar ist.
- `kiwi-policy.yaml` erhaelt neuen Block:
  ```yaml
  routing:
    providerPreference:
      planner:   [claude-code-cli]
      reviewer:  [claude-code-cli, codex-cli]
      executor:  [codex-cli, claude-code-cli, cursor-agent-cli]
      researcher: [claude-code-cli, codex-cli]
  ```
- `selectEnabledModelByAccessMode` in
  `packages/runtime/src/access-mode-resolver.ts` erhaelt einen
  optionalen Parameter `preferenceByRole`. Bei mehreren verfuegbaren
  Modellen gleicher Capability gewinnt der erste in der Liste.
- Logging: `audit.log` Eintrag `provider_preference_applied` mit
  Role, Wahl und Liste.

**Out of scope.**

- Neue Provider-Adapter (Gemini, Mistral, lokale Modelle).
- Kosten-basiertes Auto-Routing zur Laufzeit.

**Acceptance.**

- Mit `providerPreference.executor: [codex-cli, claude-code-cli]`
  und beiden verfuegbar landet ein `coding`-Step bei Codex.
- Wenn Codex fehlt, faellt das Routing transparent auf
  Claude-Code zurueck und schreibt den Grund ins Audit.
- `kiwi explain <runId>` zeigt fuer jeden Step den verwendeten
  Provider und den Grund.

**Validation.**

- Vitest fuer den Resolver mit gemockten Access-Mode-Probes.
- Smoke gegen zwei Stub-Provider.

**Aufwand.** 2-3 Tage.

### Schritt 5: UX-Politur, A2A-Trennung, `kiwi tail`

Eigenes Spec-File: `step-45-ux-polish-and-a2a-separation.md`.

**Ziel.** Spuerbar saubereres Daily Use, weniger Tool-Rauschen im MCP,
endlich `kiwi tail`.

**Scope.**

- `apps/cli/src/commands/status.ts`: Default-Output kompakt
  (`runId  status  cost  next-action`). Bestehender Detailblock hinter
  `--verbose`.
- Step 31 (CLI Error Remediation) jetzt umsetzen: `mapErrorToHelp` in
  `register-common.ts`, Hints fuer `NotInitializedError`,
  `RunNotFoundError`, `BudgetExceededError`, fehlende Provider-Auth.
- A2A-MCP-Tools (8 Stueck) hinter ENV-Flag `KIWI_A2A_MCP=1` verstecken;
  Default-Liste reduziert sich von 18 auf 10. CLI-Befehle bleiben
  unangetastet (A2A-Freeze respektiert).
- `kiwi tail <runId>` aus Step 33 umsetzen: tail+filter auf
  `audit.log`, Filter `--phase`, `--since`, `--no-color`.

**Out of scope.**

- Step 33 Streaming-Hook in den CLI-Adaptern (separat behalten).
- Aenderungen am A2A-Code selbst.

**Acceptance.**

- `kiwi status` ohne Flag zeigt eine Zeile pro Run.
- `kiwi plan ./ticket.md` in nicht-initialisiertem Repo druckt eine
  farbige Zeile `Run kiwi init [--workspace ...].`.
- MCP-`tools/list` ohne `KIWI_A2A_MCP=1` enthaelt nur Nicht-A2A-Tools.
- `kiwi tail <id>` druckt Audit-Events live.

**Validation.**

- Vitest-Snapshots fuer `status` Default und `--verbose`.
- Vitest fuer `mapErrorToHelp` mit zwei Fixtures.
- Smoke fuer `kiwi tail` gegen einen kuenstlich beschriebenen
  Audit-Log.

**Aufwand.** 2 Tage.

## Bewusst nicht im Plan

- Kein TUI und kein Dashboard.
- Keine eigene Cost-Konfigurations-YAML; die Preisliste in
  `budget-policy.ts` reicht.
- Keine neuen Provider-Adapter ueber Claude Code, Codex, Cursor-Agent
  hinaus.
- Kein Multi-Tenant, kein A2A-Ausbau.
- Kein Refactor der Modulgrenzen.

## Reihenfolge und Abhaengigkeiten

- Schritt 1 zuerst: groesster UX-Hebel, kein Risiko fuer CLI-Nutzer.
- Schritt 2 danach: entriegelt sicheren Apply-Flow; setzt nichts aus
  Schritt 1 voraus.
- Schritte 3, 4, 5 sind voneinander unabhaengig und koennen parallel
  oder in beliebiger Reihenfolge angegangen werden.

## Acceptance auf Plan-Ebene

Der Plan gilt als erfolgreich umgesetzt, wenn:

- MCP-Clients zeigen Live-Phasen waehrend `kiwi_plan` und `kiwi_run`.
- `kiwi diff` und `kiwi apply` existieren als CLI- und MCP-Tools.
  Default-Execution bleibt `direct`; `kiwi diff` ist auch dort der
  Standard-Weg, um die angewendeten Aenderungen einzusehen.
- `kiwi plan` zeigt einen Cost-Forecast als ein- bis zweizeilige
  Zusammenfassung.
- `kiwi-policy.yaml` kann Provider-Praeferenz pro Rolle setzen, und
  das Routing folgt ihr.
- `kiwi status` Default ist eine Zeile pro Run.
- A2A-Tools sind im MCP standardmaessig versteckt.
- `kiwi tail` existiert.

## Validation gesamt

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline` gruen.
- `pnpm test` gruen fuer alle betroffenen Packages.
- `scripts/smoke.mjs` ergaenzt um neue Pfade (Diff, Apply, Forecast,
  Provider-Preference, Tail).

## Naechster Schritt

Pro umgesetztem Schritt eine eigene `step-NN-*.md` mit Detail-Tasks
anlegen (Vorlage: `step-31-cli-error-remediation.md`), Implementierung,
Tests, dann `Status: DONE` setzen und Datei loeschen wie in
`docs/plans/README.md` beschrieben. Diesen Review-Plan nicht loeschen
sondern als Index erhalten, bis alle fuenf Schritte gruen sind.
