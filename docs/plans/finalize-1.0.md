# Finalisierungsplan kiwi 1.0 — Revision 2

**Datum:** 2026-05-19 (aktualisiert nach Code-Re-Check)
**Basis:** `REVIEW-kiwi-2026-05-19.md` + Verifikation gegen aktuellen `main`-Stand (commit `bc6d1d0`)
**Zielversion:** 0.1.0 → 1.0.0
**Geschätzter Restaufwand:** ~3 Arbeitstage (von ursprünglich 4–6 — viel ist schon erledigt)

## Was sich seit Review v1 geändert hat

Der commit `bc6d1d0 feat: add curated model catalog and runtime cost forecasting` hat den größten Teil von Schritt 1 und einen substantiellen Teil von Schritt 3 bereits umgesetzt. Vorhandene neue Artefakte:

- `config/model-catalog.json` (kuratierter Katalog mit pricing + tierMapping)
- `packages/core/src/config/model-catalog.ts` (`ModelRegistryUpdateService`)
- `apps/cli/src/commands/setup/models.ts` (`runModelsUpdate`)
- `apps/cli/src/__tests__/setup/models.test.ts`
- CLI-Subkommando `kiwi models update [--apply] [--workspace] [--json] [--catalog-path]` ist live (verifiziert via `node apps/cli/dist/index.js models update`)
- Makefile-Target `update-models` existiert
- Audit-Event `model_registry_refreshed` ist in `cost-ledger.ts` registriert
- `packages/runtime/src/policies/scheduler-context-package.ts` wurde aus `scheduler-policy.ts` extrahiert (`scheduler-policy.ts` jetzt 597 LoC, unter dem 600er Soft-Cap)

Außerdem hat sich eine Annahme in Schritt 4 als falsch herausgestellt: Anthropic- und Codex-CLI-Planner verwenden **bereits symmetrisch** `extractTextJson` (siehe `packages/adapters/src/integrations/anthropic/common.ts:240` und `cli-planner.ts:235`). Die echte Schema-Validation des TaskGraph passiert downstream in `packages/core/src/planning/planner.ts:485` (`TaskGraphSchema.parse`). Es gibt keine Asymmetrie. Dieser Punkt entfällt.

## Leitprinzipien (unverändert)

Wenige Schritte, klar abgegrenzt, jeder mit eigenem Merge-Point. `pnpm release:check` muss pro Schritt grün sein. Schritt 4 ist Release-Gate, alle anderen sind unabhängig mergeable und parallelisierbar.

---

## Schritt 1 — Katalog finalisieren

**Status:** ~75 % erledigt. Restarbeit: vier kleine, klar abgrenzbare Punkte.

### Was bleibt

**(a) Codex-CLI cheap/mid-Tier echt differenzieren.** Aktueller Katalog (`config/model-catalog.json:117–143`):

```json
{ "id": "codex-cli-cheap", "providerModel": "gpt-5.4-mini", "pricingRef": "openai:gpt-5.4-mini" }
{ "id": "codex-cli-mid",   "providerModel": "gpt-5.4-mini", "pricingRef": "openai:gpt-5.4-mini" }
```

Identisches Modell, identische Pricing-Referenz, identischer Pro-Token-Preis. Das Tier-Routing kann zwischen beiden nicht materiell unterscheiden. Der einzige reale Unterschied bleibt dadurch das Context-Level-Cap (`cheap_capability_l0_cap` vs `mid_capability_l1_cap` im Scheduler) — also nur Token-Menge, nicht Token-Preis.

Optionen:

- **A:** Realistisches kleineres Modell für `cheap` finden (z.B. ein Nano-Tier sobald Codex-CLI das supportet) und im Katalog separat anlegen.
- **B:** `codex-cli-cheap` als `enabled: false` markieren bis ein echtes Cheap-Tier existiert. Dann fällt das Routing automatisch auf `claude-code-cli-mid` bzw. `stub` zurück. Sauberer als gefakte Differenzierung.
- **C:** Im Katalog dokumentieren (Kommentar oder eigenes Feld), dass die Differenzierung bei Codex-CLI rein contextual ist, nicht preislich.

Empfehlung: **B** kurzfristig, **A** sobald ein passender Codex-Modellname verfügbar ist.

**(b) Fictional `gpt-5.x` Modellnamen.** Der Katalog setzt aktuell `providerModel: "gpt-5.4"`, `"gpt-5.4-mini"`, `"gpt-5.5"`. Solche OpenAI-Modelle existieren nicht. Drei Optionen:

- Für jedes Codex-Tier `providerModel: null` setzen und im Doctor anzeigen "Codex-Modellname muss manuell konfiguriert werden", analog zu `claude-code-cli-*` heute (siehe `claudeCodeAuthAvailable`-Pfad).
- Auf reale Codex-CLI-akzeptierte Namen umstellen (erfordert Stand-der-Recherche zum Release-Zeitpunkt — der konkrete Codex-Modellpool ist Codex-CLI-Versions-spezifisch).
- Pricing-Feld auf 0/0 setzen und `pricingLastVerifiedAt: null` + Source-Hinweis "Codex-CLI; konkrete Modellpreise stehen lokal nicht zur Verfügung".

Empfehlung: Kombination — `providerModel: null` plus separater Doctor-Hinweis. Damit fällt das Kosten-Estimate für Codex auf Null (akzeptiert) und der User wird sauber instruiert, einen lokalen Override anzulegen.

**(c) `kiwi models list` Lese-Pendant.** Schwesterkommando zu `update`, zeigt aktuell registrierte Modelle mit Capability, Access-Mode-Verfügbarkeit, Pricing-Snapshot und `pricingLastVerifiedAt`. Liefert das, was bisher in `kiwi doctor` versteckt ist, fokussiert auf Modelle. Sollte einen `--json` Flag haben für IDE-Konsumenten.

**(d) MCP-Tool `kiwi_models_update`.** Heute kann ein IDE-Assistent nur per CLI-Shellout updaten. Ein MCP-Tool mit Dry-Run-Default + Confirm-Required-Pattern (analog `kiwi_preview_run`) macht das Refresh-Erlebnis aus der IDE heraus erstklassig:

```text
kiwi_models_update         -> liefert diff + previewToken
user confirms              -> kiwi_models_update_apply --previewToken=...
```

Optional, aber sinnvoll für 1.0, weil es das "kiwi ist über die IDE bedienbar"-Versprechen abrundet.

**(e) Anthropic-API `DEFAULT_MODEL` in der Source auf 4-7 angleichen** (`packages/adapters/src/integrations/anthropic/planner-provider.ts:37`). Heute steht dort noch `claude-opus-4-6` als Fallback, der Katalog setzt aber bereits `claude-opus-4-7`. Kein Bug (Katalog gewinnt via `providerModel`), aber inkonsistent.

### Done-Kriterien

- `kiwi doctor` zeigt keine warnungslose "cheap=mid mit gleichem Pricing"-Konfiguration mehr
- `kiwi models list --json` liefert maschinenlesbare Modellübersicht
- `kiwi_models_update` als MCP-Tool in `definitions.ts` registriert, mit Tests
- Anthropic-Source-Defaults konsistent mit Katalog

**Restaufwand:** ~0,75 Tag

---

## Schritt 2 — Run-Lock Stale-Recovery

**Status:** Komplett offen. Unverändert aus Revision 1.

### Scope (unverändert)

- `packages/core/src/runs/lock.ts:52–132` erweitern:
  - Bei `acquireRunLock` mit `EEXIST`: `process.kill(existing.ownerPid, 0)` probieren. `ESRCH` → Owner tot → Lockfile entfernen, neu anlegen, Audit-Event `run_lock_reclaimed`.
  - `release()` prüft vor `unlinkSync`, ob der Lockfile noch unsere PID trägt.
- Neuer Command `kiwi runs unlock <run-id>` mit `--force` Flag, schreibt Audit-Event `run_lock_forced_release` mit `approvedBy`-Identity.
- `kiwi doctor`: pro Run mit aktivem Lockfile prüfen, ob `ownerPid` lebt. Stale Locks als Warning ausgeben.

### Done-Kriterien (unverändert)

- Tests: Crash-Simulation, Reclaim-Pfad, Force-Unlock, Doctor-Warning
- `docs/architecture.md`-Persistence-Layout um optionales `expiresAt` ergänzt

**Aufwand:** ~0,5 Tag

---

## Schritt 3 — Hotspot-Reduktion Restpunkte

**Status:** ~30 % erledigt. `scheduler-policy.ts` wurde bereits gesplittet (siehe oben). Zwei Files und eine Methode bleiben.

### Was bleibt

**(a) `apps/mcp-server/src/tools/run-tools.ts` (647 LoC)** in zwei Files aufteilen:
- `run-tools.ts` (öffentliche Tool-Functions, ~350 LoC)
- `run-tool-internals.ts` (`assertMcpDirectExecutionSafe`, `validateRunToolPreview`, helper-Functions, ~300 LoC)

**(b) `apps/cli/src/commands/setup/init.ts` (645 LoC)** in drei Files:
- `init.ts` (Command-Definition + Orchestrierung, ~250 LoC)
- `init-mcp-config.ts` (Cursor/Claude/Codex MCP-Config-Generierung)
- `init-workspace-state.ts` (`.kiwi/config.yaml` und Home-Defaults Writes)

**(c) `packages/runtime/src/execution/step-attempt-orchestrator.ts:209–402`:** Methode `blockBudgetExceeded` (~193 Zeilen) extrahieren als eigene Datei `step-attempt/budget-blocked-writer.ts`. Kapselt die ~10 sequentiellen `writeJsonSafely`/`saveReviewVerdict`/`saveRunnerCostReport`/`persistAttemptCompletion`/`auditAttemptFinished` Aufrufe. Hauptklasse schrumpft von 533 auf etwa 340 LoC.

**(d) `pnpm lint:baseline:init`** aufrufen, Baseline frisch generieren, alten Einträgen (dispatcher.ts, planned-steps/index.ts, scheduler-policy.ts) wegsäubern, Diff committen.

### Wichtig: reiner Strukturrefactor

Keine Schema-Änderungen, keine neuen Audit-Events, keine geänderten Default-Pfade. Bestehende Tests laufen identisch durch, keine neuen Tests nötig (nur Imports anpassen).

### Done-Kriterien

- Keine Source-Datei mehr über 600 LoC außer Contracts-Aggregaten
- `config/eslint-baseline.json` frisch, ohne tote Einträge
- `pnpm release:check` grün
- `pnpm bundle:check` ohne neue Runtime-Requires

**Aufwand:** ~1 Tag

---

## Schritt 4 — Release-Gate 1.0

**Status:** Komplett offen. Reduziert gegenüber Revision 1 (Codex-Zod-Validation entfällt — bereits symmetrisch).

### Scope

- **`kiwi config set approver <identity>`** Command, persistiert nach `<workspace>/.kiwi/config.yaml` unter neuem Feld `approver.identity`. Plus Doctor-Warning wenn weder `KIWI_MCP_APPROVED_BY` Env noch Workspace-Config gesetzt ist (relevant für den Approval-Flow in `kiwi_request_approval`, siehe `apps/mcp-server/src/tools/next-action.ts:165–173`).
- **Version-Bump 0.1.0 → 1.0.0** in allen Workspace-`package.json`s und `apps/cli/src/index.ts:8` (`pkgVersion = "0.1.0"` — hardcoded).
- **`CHANGELOG.md` erstellen** mit Sektionen für die seit der ersten Release-Vorbereitung erfolgten Schritte (curated catalog, scheduler-policy split, models update, run-lock recovery, etc.). Keine Auto-Generierung — die Commit-Messages sind teilweise zu generisch ("bugs 6", "fixes 7") um daraus changelog-fähigen Text zu ziehen.
- **README + `docs/user-guide.md`** Pass:
  - Quickstart erwähnt `kiwi models update`
  - Recovery-Sektion mit `kiwi runs unlock` und `kiwi doctor`-Output bei stale lock
  - Modell-Defaults-Tabelle in der Doku reflektiert claude-opus-4-7 / -sonnet-4-6 / -haiku-4-5
- **Full Release-Check Lauf** in sauberem Container: `make install` from scratch, `kiwi doctor`, `kiwi plan`, `KIWI_ALLOW_STUB=1 kiwi run`, `kiwi finalize`, `kiwi evidence manifest`. Output als Release-Notes-Anhang.
- **MCP-Integration-Smoke-Test:** kiwi-mcp-Server in mindestens einer IDE starten und den vollen `kiwi_doctor → kiwi_plan → kiwi_preview_run → kiwi_run → kiwi_finalize` Flow durchklicken. Screenshots in `docs/integrations/<name>.md` aktualisieren falls UX gedriftet ist.

### Done-Kriterien

- Git-Tag `v1.0.0`
- Frisch installierter User durchläuft Stub-End-to-End-Szenario ohne YAML-Edit
- Alle Integrationsdokumente konsistent mit der 1.0-API

**Aufwand:** ~0,75 Tag

---

## Was bewusst nicht im 1.0-Plan ist (unverändert)

- `kiwi_diff_summary`-MCP-Tool (Review P2)
- Konfigurierbare Secret-Pattern-Regexe (Review P3)
- SCM-Provider-Parität (GitHub, GitLab)
- Operator-UI-Erweiterung

**Neu auf der Streichliste (Revision 2):**

- Codex-CLI-Planner Zod-Validation. Bereits symmetrisch zu Anthropic; downstream-Validation passiert in `core/planning/planner.ts:485`. Kein Handlungsbedarf.

---

## Aktualisierte Reihenfolge & Parallelisierbarkeit

```
Schritt 1 (Katalog-Polish, ~0,75 Tag)  ──┐
                                          ├──> Schritt 4 (Release-Gate, ~0,75 Tag)
Schritt 2 (Lock-Recovery, ~0,5 Tag)    ──┤
                                          │
Schritt 3 (Hotspots Rest, ~1 Tag)      ──┘
```

Schritte 1, 2, 3 sind voneinander unabhängig. Realistisch in zwei Arbeitstagen parallel erledigbar, Schritt 4 schließt einen weiteren Tag ab. Damit insgesamt ~3 Tage bis 1.0 (gegenüber 4–6 in Revision 1).

---

## Erfolgsmetrik (unverändert)

> *"Ich installiere kiwi, logge mich in einer der unterstützten CLIs ein, gebe meinem IDE-Assistenten ein Ticket, und kiwi plant, executet und reviewt den Run mit korrekt getierten Modellen, audit-fähig und unter Budget-Kontrolle — ohne YAML-Edit."*

Stand heute scheitert dieser Satz noch an:
1. Codex-`cheap`/`mid`-Identität (Schritt 1a)
2. Fictional `gpt-5.x` Modellnamen falls User Codex präferieren will (Schritt 1b)
3. Recovery-Falle wenn ein Prozess während einem Run crasht (Schritt 2)

Nach Schritten 1+2 ist der Satz wahr, Schritt 3 macht das Hinzufügen weiterer Features billiger, Schritt 4 ist das saubere Release-Schließen.

---

## Verifikationsnotizen für diese Revision

Stichproben gegen `main` `bc6d1d0`:

- `wc -l packages/runtime/src/policies/scheduler-policy.ts` → 597 ✓ (war 787 zum Review-Zeitpunkt)
- `wc -l apps/mcp-server/src/tools/run-tools.ts` → 647 ✓ (unverändert über Cap)
- `wc -l apps/cli/src/commands/setup/init.ts` → 645 ✓ (unverändert über Cap)
- `wc -l packages/runtime/src/execution/step-attempt-orchestrator.ts` → 533 ✓
- `node apps/cli/dist/index.js models update --workspace …` → funktioniert, Dry-Run-Default, schreibt nicht ohne `--apply` ✓
- `grep "name: \"kiwi_" apps/mcp-server/src/tools/definitions.ts | wc -l` → 17 MCP-Tools, `kiwi_models_update` nicht dabei ✗
- `grep -rn "runs unlock\|process.kill.*ownerPid" packages apps` → keine Treffer ✗
- `grep "version" package.json` → 0.1.0 ✗
- `ls CHANGELOG*` → existiert nicht ✗
- `extractTextJson` wird in beiden Anthropic- und Codex-Planner-Pfaden verwendet ✓ (Schritt 4-Punkt aus Revision 1 ist obsolet)
