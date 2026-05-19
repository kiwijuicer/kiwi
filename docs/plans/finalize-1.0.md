# Finalisierungsplan kiwi 1.0

**Datum:** 2026-05-19
**Basis:** `REVIEW-kiwi-2026-05-19.md`
**Zielversion:** 0.1.0 → 1.0.0
**Geschätzter Aufwand insgesamt:** 4–6 Arbeitstage

## Leitprinzipien

Vier Schritte, jeder mit klar abgegrenztem Scope und eigenem Merge-Point. Keine Vermischung von Feature- und Refactor-Arbeit innerhalb eines Schritts. Jeder Schritt schließt mit `pnpm release:check` grün ab. Schritt 4 ist Release-Gate, alle anderen sind unabhängig mergeable.

---

## Schritt 1 — Model-Katalog & `kiwi models update`

**Warum zuerst:** Out-of-the-Box-Erfahrung ist heute kaputt (fiktive `gpt-5.x`-Namen, `cheap`=`mid`-Pricing). Ohne diesen Fix ist kein 1.0-Release ehrlich. Schließt P1 aus dem Review plus die in der Folgediskussion abgestimmte Katalog-Idee ab.

### Scope

- `config/model-catalog.json` als kuratierte, versionierte Quelle der Wahrheit. Schema: `{ catalogVersion, generatedAt, providers: { anthropic | codex-cli | claude-code-cli | cursor-agent-cli: { models[], tierMapping, pricingLastVerifiedAt } } }`.
- `apps/cli/src/commands/models/update.ts` mit Subcommands:
  - `kiwi models update` — Diff-Ausgabe gegen aktuelles `~/.kiwi/defaults/model-registry.yaml`, kein Write
  - `kiwi models update --apply` — Atomic-Write mit Audit-Event `model_registry_refreshed`
  - `kiwi models update --workspace <path>` — schreibt Workspace-Overlay statt Home-Default
- `kiwi models list` als Lese-Pendant: zeigt aktuell registrierte Modelle plus Verfügbarkeit (analog zu `doctor`).
- Korrigierter Default-Katalog (initial):
  - Anthropic: planner `claude-opus-4-7`, reviewer `claude-sonnet-4-6` (anstelle der aktuellen Opus-4-6-Defaults)
  - Codex-CLI: differenziertes `cheap` (mini-Tier) vs `mid` (small-Tier) — entweder mit echten Modellnamen, falls Codex-CLI sie bei Release supported, oder mit `providerModel: null` und Hinweis im Doctor, dass der User den Codex-spezifischen Namen ergänzen muss
- `make update-models` Makefile-Target als Convenience-Wrapper

### Safety

- Workspace-Overlay-Edits werden niemals überschrieben (nur Home-Defaults)
- Vor dem Write: identisches Hash-Pattern wie bei Preview-Tokens → Diff anzeigen, Confirm verlangen
- Audit-Event mit catalogVersion-vorher/nachher und Liste der geänderten Modell-IDs

### Done-Kriterien

- Frischer User kann `make install && kiwi init && kiwi models update --apply && kiwi doctor` ausführen und bekommt für mindestens einen Provider (Anthropic) eine arbeitsfähige Modell-Tier-Belegung ohne YAML-Edits
- Tests: Diff-Generierung, Workspace-Overlay-Respect, Audit-Event, Stale-Catalog-Erkennung
- `docs/user-guide.md` und README-Quickstart updated

**Aufwand:** ~1,5 Tage

---

## Schritt 2 — Run-Lock Stale-Recovery

**Warum:** Single-Point-of-Failure für Daily-Use. Ein einziger Prozess-Crash mitten in einem Run hinterlässt einen Lockfile, der jeden weiteren Call auf diesen Run blockiert. Trivialer Bug für Endnutzer, schwer zu diagnostizieren ohne Doc-Lookup.

### Scope

- `packages/core/src/runs/lock.ts` erweitern:
  - Beim `acquireRunLock` mit `EEXIST` zusätzlich prüfen: `process.kill(existing.ownerPid, 0)`. Wirft `ESRCH` → Owner ist tot → Lockfile entfernen und neu anlegen, mit Audit-Event `run_lock_reclaimed`.
  - Optional: TTL-Feld `expiresAt` im Lock-Info-Record, damit auch externes Watchdog-Cleanup deterministisch ist.
- `release()` prüft vor `unlinkSync`, ob der Lockfile noch unsere PID trägt — Schutz gegen das Edge-Case "anderer Prozess hat in der Zwischenzeit übernommen".
- Neuer Operator-Command: `kiwi runs unlock <run-id>` mit `--force` Flag. Schreibt Audit-Event `run_lock_forced_release` mit "approvedBy"-Identity (analog approval-Flow).
- `kiwi doctor` Check: pro Run mit aktivem Lockfile prüfen, ob `ownerPid` lebt. Stale Locks werden als Warning ausgegeben mit Hinweis auf `kiwi runs unlock`.

### Done-Kriterien

- Tests: Crash-Simulation (Lockfile mit nicht-existenter PID), Reclaim-Pfad, Force-Unlock-Pfad, Doctor-Warning-Pfad
- Doctor-Output zeigt im Test-Workspace einen simulierten Stale Lock korrekt an
- `docs/architecture.md`-Persistence-Layout um `expiresAt`-Feld ergänzt

**Aufwand:** ~0,5 Tag

---

## Schritt 3 — Hotspot-Reduktion & Code-Health-Baseline-Refresh

**Warum:** Drei Source-Files überschreiten den selbst definierten 600-LoC-Soft-Cap (`scheduler-policy.ts` 787, `run-tools.ts` 647, `init.ts` 645). Plus `blockBudgetExceeded` als 193-Zeilen-Methode. Außerdem ist `config/eslint-baseline.json` stale (listet bereits gefixte Files). Tech-Debt, der ohne Refactor jede Folge-Feature-Implementation teurer macht.

### Scope

- `packages/runtime/src/policies/scheduler-policy.ts` (787 → drei Files):
  - `scheduler-policy.ts` (Service + öffentliche API, ~200 LoC)
  - `scheduler-routing.ts` (`determineAgentRole`, `determineModelCapability`, `determineContextLevel`, `determineReviewDepth`, `determineRequiredGates`)
  - `scheduler-context-package.ts` (`buildContextPackage`, `fileSnapshotPaths`, `readFileSnapshot`)
- `apps/mcp-server/src/tools/run-tools.ts` (647 → zwei Files):
  - `run-tools.ts` (öffentliche Tool-Functions)
  - `run-tool-internals.ts` (`assertMcpDirectExecutionSafe`, `validateRunToolPreview`, helper-Functions)
- `apps/cli/src/commands/setup/init.ts` (645 → drei Files):
  - `init.ts` (Command-Definition + Orchestrierung)
  - `init-mcp-config.ts` (Cursor/Claude/Codex MCP-Config-Generierung)
  - `init-workspace-state.ts` (`.kiwi/config.yaml` und `~/.kiwi/defaults/*` Writes)
- `packages/runtime/src/execution/step-attempt-orchestrator.ts`: `blockBudgetExceeded`-Methode extrahieren als `BudgetBlockedAttemptWriter` in eigener Datei (~190 LoC einzeln). Side-Effects an einer Stelle kapselt, Hauptklasse wird vom 533-LoC-File auf etwa 350 LoC schrumpfen.
- `pnpm lint:baseline:init` aufrufen, Baseline frisch generieren, Diff ins Commit aufnehmen. Erwartung: deutlich kleinere Baseline.

### Wichtig: kein Verhaltensänderungen

Schritt 3 ist ein reiner Strukturrefactor. Keine Schema-Änderungen, keine neuen Audit-Events, keine geänderten Default-Pfade. Tests laufen identisch durch — Verifikation via existierender Test-Suite ohne neue Tests.

### Done-Kriterien

- Keine Source-Datei mehr über 600 LoC außer Contracts-Aggregate (die per Eslint-Override exempt sind)
- `config/eslint-baseline.json` zeigt höchstens Einträge für `scheduler-routing.ts` oder ähnliche neue Dateien — die alten dispatcher.ts/planned-steps-Einträge sind weg
- `pnpm release:check` grün
- Bundle-Check (`pnpm bundle:check`) passiert ohne neue Runtime-Requires

**Aufwand:** ~2 Tage (sorgfältig, mit jedem Split einzelnes Commit)

---

## Schritt 4 — Release-Gate 1.0

**Warum:** Letzte Schicht. Schließt verbleibende kleinere Review-Empfehlungen und packt das 1.0-Release.

### Scope

- **Codex-CLI Planner-Output Zod-Validation** (`packages/adapters/src/providers/cli-planner.ts`): die `parsed: unknown` aus dem CLI-Result muss durch ein Zod-Schema laufen, bevor sie als TaskGraph weitergereicht wird — symmetrisch zum Anthropic-Pfad. Tests mit malformed JSON-Lines, abgebrochene LLM-Antworten, Schema-Drift.
- **`kiwi config set approver <email>`** Command, plus Doctor-Warning wenn `KIWI_MCP_APPROVED_BY` weder gesetzt noch konfiguriert. Persistiert nach `<workspace>/.kiwi/config.yaml` unter neuem Feld `approver.identity`.
- **Version-Bump 0.1.0 → 1.0.0** in `package.json` (alle Workspace-Packages), `kiwi --version` reflektiert.
- **CHANGELOG.md** erstellen mit Übersicht der Schritte 1–4.
- **README + `docs/user-guide.md`** Pass:
  - Quickstart erwähnt `kiwi models update`
  - Hinweis auf `kiwi runs unlock` für Recovery-Fälle
  - Default-Anthropic-Modelle in der Tabelle aktualisiert
- **Full Release-Check Lauf** in CI-äquivalentem sauberem Container: `make install` from scratch, `kiwi doctor`, `kiwi plan`, `kiwi run` mit Stub-Mode, `kiwi finalize`, `kiwi evidence manifest`. Output als Release-Notes-Anhang.
- **MCP-Integration-Smoke-Test:** kiwi-mcp-Server in mindestens einer IDE (Cursor oder Claude Code) starten und den vollen `kiwi_doctor → kiwi_plan → kiwi_preview_run → kiwi_run → kiwi_finalize` Flow durchklicken. Screenshot-Dokumentation in `docs/integrations/<name>.md` aktualisieren falls UX seit letzter Verifikation abgewichen ist.

### Done-Kriterien

- Git-Tag `v1.0.0`
- Frisch installiertes kiwi durchläuft ein Stub-Ende-zu-Ende-Szenario ohne YAML-Edits durch den User
- Alle Integrationsdokumente sind mit der 1.0-API konsistent

**Aufwand:** ~1 Tag

---

## Was bewusst nicht im 1.0-Plan ist

- **`kiwi_diff_summary`-MCP-Tool** (Review P2). Sinnvoll, aber Nice-to-have. Nach 1.0 in einem Punktrelease.
- **Konfigurierbare Secret-Pattern-Regexe** (Review P3). Aktuelle Pattern-Liste deckt die wichtigsten Token-Shapes ab. Erweiterung wenn ein konkreter Org-Use-Case auftaucht.
- **SCM-Provider-Parität (GitHub, GitLab) jenseits Bitbucket.** Eigener Roadmap-Punkt nach 1.0, braucht ein ADR.
- **Operator-UI-Erweiterung.** Vision-Doc-Future-Scope, nicht 1.0-blocker.

---

## Reihenfolge & Parallelisierbarkeit

```
Schritt 1 (Katalog)         ──┐
                              ├──> Schritt 4 (Release-Gate)
Schritt 2 (Lock-Recovery)   ──┤
                              │
Schritt 3 (Hotspot-Refactor)──┘
```

Schritte 1, 2, 3 sind voneinander unabhängig und können parallel laufen (z.B. einer pro Entwickler oder einer pro Wochenhälfte). Schritt 4 setzt grünen Stand der drei voraus.

---

## Erfolgsmetrik

Bei 1.0-Release sollte folgender Satz wahr sein, und zwar ohne dass der Nutzer eine YAML-Datei manuell editieren muss:

> *"Ich installiere kiwi, logge mich in einer der unterstützten CLIs (Codex / Claude Code / Cursor Agent) ein, gebe meinem IDE-Assistenten ein Ticket, und kiwi plant, executet und reviewt den Run mit korrekt getierten Modellen, audit-fähig und unter Budget-Kontrolle."*

Heute scheitert dieser Satz am Default-Model-Registry. Nach Schritt 1 ist er erreichbar. Schritte 2–4 sorgen dafür, dass er es im Failure-Case bleibt und die Codebasis dabei wartbar ist.
