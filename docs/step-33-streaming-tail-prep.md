# Step 33 – Streaming / Tail: Vorbereitungsanalyse

> Warum separat? Streaming schneidet quer durch alle Schichten:
> subprocess-Contract → CLI-Client-Invocations → RunnerAdapter-Contract → runtime → MCP/CLI-Surface.
> Außerdem erzwingt TTY-Verhalten Entscheidungen, die alle drei CLI-Runner betreffen.

---

## 1. Ist-Zustand (was heute existiert)

### subprocess.ts (`packages/adapters/src/subprocess.ts`)

```
stdio: ["ignore", "pipe", "pipe"]   // kein TTY, kein stdin
detached: process.platform !== "win32"
```

- `runSubprocess()` akkumuliert `stdout`/`stderr` komplett als String.
- Resolve erst nach `child.on("close", ...)` → **batch-only, kein Live-Output**.
- Gleiche Struktur in `packages/sandbox/src/process-execution.ts` (`spawnSandboxCommand`).

### CLI-Clients (alle drei benutzen `runSubprocess`)

| Client | Datei | Streaming-Opt? | TTY-Arg? |
|---|---|---|---|
| `DefaultClaudeCodeCliRunner` | `claude-code-cli/client.ts` | ❌ | `--output-format json` |
| `DefaultCursorAgentCliRunner` | `cursor-agent-cli/client.ts` | ❌ | `--output-format json/stream-json` |
| `DefaultCodexCliRunner` | `codex-cli/client.ts` | ❌ | `--json` |

### RunnerAdapter-Contract (`runner-adapter.ts`)

```ts
interface RunnerAdapter {
  execute(input: RunnerExecutionInput): Promise<RunnerExecutionOutput>;
}
```

- Vollständig fire-and-wait. Kein Streaming-Slot.
- `RunnerExecutionOutput` enthält **kein** `liveLogPath`-Feld.

### runner-logs.ts

- Schreibt **einmalig** den vollständigen Log als JSON, nach Prozessende.

### MCP-Server / CLI-App

- `kiwi_run_step` / `kiwi_run` awaiten `executePlannedStep()` synchron.
- Kein Fortschritts-Output während der Ausführung.

---

## 2. Warum Step 33 alles querschneidet

```
subprocess.ts                 ← muss onOutputChunk kennen
    ↓
[claude/cursor/codex]-client  ← muss onOutputChunk durchreichen
    ↓
cli-runner-output.ts          ← muss liveLogPath setzen
    ↓
runner-adapter.ts             ← Typ-Erweiterung (optional liveLogPath)
    ↓
runtime / step-attempt-orchestrator  ← könnte live tail aktivieren
    ↓
MCP-Server / CLI-App          ← könnte "tail" für den Operator anbieten
```

Außerdem: **TTY-Entscheidung** beeinflusst alle CLI-Runner gleichzeitig.

---

## 3. TTY-Analyse

### Problem

Manche CLIs prüfen `process.stdout.isTTY`:
- Claude Code CLI: aktiviert interaktiven Modus wenn TTY → **JSON-Output wird stillschweigend abgeschaltet**
- Codex CLI: ähnlich – ANSI-Escape-Codes erscheinen wenn TTY erkannt wird
- Cursor Agent CLI: `--output-format stream-json` liefert NDJSON-Lines unabhängig vom TTY

### Aktuelle Absicherung

Alle drei CLIs bekommen explizite `--output-format` / `--json` Flags → TTY-Autodetect des CLI greift **nicht**, weil der Format-Flag Vorrang hat. Das ist korrekt und soll so bleiben.

### Was Step 33 NICHT braucht

- `node-pty` (Pseudo-Terminal) – erzeugt native Binary-Dependency, kompliziert build matrix, wird nicht benötigt solange alle CLIs explizite Format-Flags haben
- ANSI-Stripping – da kein TTY → keine ANSI-Codes in pipe-Mode

### Was Step 33 SICHERSTELLEN muss

- Prüfen, ob `claude` bei `--output-format json` wirklich kein `isTTY`-Fallback macht
- Für `cursor` mit `stream-json`: sicherstellen dass NDJSON-Lines auch ohne TTY fließen
- Entsprechender Testfall: `runSubprocess` mit einem Skript das `process.stdout.isTTY` ausgibt → muss `undefined` oder `false` sein

---

## 4. Empfohlenes minimales Design

### A. `SubprocessInvocation` – optionaler Chunk-Callback

```ts
// subprocess.ts
interface SubprocessInvocation {
  // ... bestehende Felder ...
  onOutputChunk?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void;
}
```

In `runSubprocess()`:
```ts
child.stdout.on("data", (chunk: Buffer) => {
  const text = chunk.toString("utf-8");
  stdout = truncateOutput(stdout + text, invocation.maxOutputBytes);
  invocation.onOutputChunk?.({ stream: "stdout", text });
});
// analog für stderr
```

→ **Rückwärtskompatibel**: bestehende Callers ohne Callback bleiben unverändert.

### B. `liveLogPath` in `RunnerExecutionOutput`

```ts
// runner-adapter.ts
interface RunnerExecutionOutput {
  // ... bestehende Felder ...
  liveLogPath?: string;   // optional, nur wenn Streaming aktiv
}
```

Caller kann optional darauf `tail -f` aufrufen. Kein Zwang.

### C. `streamRunnerLogs()` in `runner-logs.ts`

```ts
// runner-logs.ts
export function openStreamingRunnerLog(params: {
  workspacePath: string; runId: string; stepId: string; attemptId: string; runner: string;
}): { path: string; append(chunk: { stream: "stdout"|"stderr"; text: string }): void; close(): void }
```

- Schreibt inkrementell NDJSON-Lines in `…/artifacts/<runner>-runner-stream.jsonl`
- `persistRunnerLogs()` bleibt wie bisher für den finalen Batch-Log

### D. CLI-Clients – `onOutputChunk` durchreichen

```ts
// claude-code-cli/client.ts
interface ClaudeCodeCliInvocation {
  // ... bestehende Felder ...
  onOutputChunk?: (chunk: { stream: "stdout"|"stderr"; text: string }) => void;
}
```

`DefaultClaudeCodeCliRunner.run()` leitet `onOutputChunk` an `runSubprocess` weiter.
Gleiches Muster für Cursor und Codex.

### E. `cliRunnerOutput()` – liveLogPath setzen

```ts
// cli-runner-output.ts
export function cliRunnerOutput(params: {
  // ... bestehende Felder ...
  liveLogPath?: string;
}): RunnerExecutionOutput {
  return {
    ...baseOutput,
    liveLogPath: params.liveLogPath,
    // ...
  };
}
```

---

## 5. Was Step 33 explizit NICHT anpackt

| Thema | Begründung |
|---|---|
| `RunnerAdapter.execute()` Signatur ändern (async-iterable) | Zu viele Aufruforte, kein konkreter Consumer-Bedarf |
| `spawnSandboxCommand` (sandbox) streamen | Sandbox ist für local-shell-runner, kurze Commands – kein langer Output erwartet |
| MCP-Server live-streaming | JSON-RPC unterstützt kein echtes Streaming; `liveLogPath` ist der Escape-Hatch |
| `node-pty` / PTY-Emulation | Kein Bedarf, solange CLIs Format-Flags akzeptieren |
| `stream-json` für Cursor aktivieren | Cursor-Adapter funktioniert batch – Änderung ist separater Step wenn konkret benötigt |

---

## 6. Berührte Dateien

```
packages/adapters/src/subprocess.ts              (onOutputChunk callback)
packages/adapters/src/runner-logs.ts             (openStreamingRunnerLog)
packages/adapters/src/runner-adapter.ts          (liveLogPath? in Output)
packages/adapters/src/cli-runner-output.ts       (liveLogPath? propagation)
packages/adapters/src/claude-code-cli/client.ts  (onOutputChunk passthrough)
packages/adapters/src/cursor-agent-cli/client.ts (onOutputChunk passthrough)
packages/adapters/src/codex-cli/client.ts        (onOutputChunk passthrough)
```

**Nicht berührt:**
```
packages/sandbox/src/process-execution.ts   (bleibt batch)
packages/runtime/                           (kein Streaming-Consumer)
apps/mcp-server/                            (liveLogPath expose via kiwi_status? → separater Step)
packages/contracts/                         (kein Schema-Change nötig)
```

---

## 7. Test-Plan

### Unit Tests (`packages/adapters/src/__tests__/`)

1. **`subprocess-streaming.test.ts`** (neu)
   - `onOutputChunk` wird pro Chunk aufgerufen, bevor `runSubprocess` resolved
   - Gesamtergebnis (`stdout`) ist Summe aller Chunks
   - Ohne `onOutputChunk`: bisheriges Verhalten unverändert (regression check)
   - TTY-Check: Skript gibt `process.stdout.isTTY` aus → muss falsy sein

2. **`runner-logs-streaming.test.ts`** (neu)
   - `openStreamingRunnerLog` schreibt NDJSON inkrementell
   - `.close()` schreibt valides JSONL (parseable lines)

3. **Bestehende Runner-Tests**: müssen weiterhin grün sein (keine Breaking Changes)

---

## 8. Reihenfolge-Empfehlung

```
Step 33a: subprocess.ts – onOutputChunk callback + TTY-Test
Step 33b: runner-logs.ts – openStreamingRunnerLog
Step 33c: cli-runner-output.ts + runner-adapter.ts – liveLogPath
Step 33d: alle drei CLI-Clients – onOutputChunk durchreichen
```

Getrennte Commits, damit Reviewer den Querschnitt nachvollziehen können.
