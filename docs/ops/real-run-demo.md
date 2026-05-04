# Production Milestone 1 — Real Run Demo

Status: READY (executes locally; final demo run is operator-driven)
Last-Updated: 2026-05-04

## Goal

Take a real ticket through the full kiwi loop — plan, run, gates, review,
finalize, evidence — using the best available local provider stack
(Claude Code CLI first, Cursor Agent CLI when available, direct APIs only
when explicitly configured), with auditable evidence trail.

## Provider Resolution

kiwi resolves providers at invocation time in this order:

1. `KIWI_FORCE_ACCESS_MODE` environment override
2. `claude-code-cli` (uses local `claude` CLI auth)
3. `codex-cli` / `cursor-agent-cli` for runner access when locally available
4. `anthropic-api` / `openai-api` when explicitly enabled and keyed
5. `cursor` / `jetbrains` as IDE surfaces, plus `local`
6. `stub` (tests only)

Run `kiwi doctor` from your workspace to see which access modes are
currently available.

## Pre-flight

```bash
make install                 # build, install ~/.local/bin/kiwi
make install-cursor-agent    # optional, only when Cursor is already installed
which claude || true         # optional Claude Code CLI
which cursor-agent || true   # optional Cursor Agent CLI
kiwi --version               # prints "0.1.0 (<git short sha>)"
kiwi doctor                  # probes policies, registry, access modes
```

If Cursor is on `PATH` but `cursor-agent` is missing, `make install` prints
the optional runner install command. To fold it into install, run:

```bash
make install INSTALL_CURSOR_AGENT=1
```

Cursor SDK is not required for this flow and remains optional because it uses
`CURSOR_API_KEY`.

## End-to-End Flow

```bash
# 1. Initialize the workspace (idempotent; preserves existing config)
kiwi init --workspace /path/to/your/repo

# 2. Plan a real ticket. Pass either an inline ticket or a path to a markdown file.
kiwi plan ./ticket.md \
  --workspace /path/to/your/repo \
  --repo your-repo-id

# 3. Inspect the plan
kiwi status

# 4. Run the planned steps
kiwi run <run-id>

# 5. Finalize: writes final-summary.md, final-verdict.json, final-cost-report.json
kiwi finalize <run-id>

# 6. Evidence manifest with hashes for verification
kiwi evidence manifest <run-id>

# 7. Operator HTML snapshot (optional)
kiwi operator snapshot <run-id>
```

## What gets persisted (`.kiwi/runs/<run-id>/`)

```
run.json
initiative.json
plan/
  task-graph.json
  planner-input.json    # redacted prompt + envelope
  planner-output.json   # provider response + extracted TaskGraph
  cost-report.json
steps/<stepId>/<attemptId>/
  attempt.json
  context-package.json
  artifacts/
    diff.patch                      # captured via git diff (worktree mode)
    review-report.json              # structured ReviewVerdict
    reviewer-input.json             # redacted reviewer prompt
    reviewer-output.json            # provider response + verdict
    forbidden-file-report.json      # diff-time path policy gate
    secrets-report.json             # diff-time entropy/regex scan
    cost-report.json
    command-output*.json            # gate command outputs
  gate-results.json
  attempt-summary.json
final/
  final-summary.md
  final-verdict.json
  final-cost-report.json
  evidence-manifest.json
logs/
  audit.log
```

## Provider Evidence Model

Cost and usage are recorded per-invocation in `audit.log` and per-step in
`cost-report.json`. The level of precision is captured explicitly:

- **exact** — direct API responses with `usage` block (anthropic-api,
  openai-api). Token counts and USD reflect real billing.
- **estimated** — usage was reported but cost was approximated locally
  (e.g. CLI envelope without `total_cost_usd`).
- **unknown** — CLI/IDE adapter that did not expose usage. The raw
  invocation evidence (command, stdout, stderr, durations) is preserved
  so an operator can correlate with their provider dashboard.

Stubs always record zero-cost and never enter a real-evidence demo run.

## Acceptance Checklist

- [ ] `kiwi doctor` shows at least one non-stub access mode as `available`
- [ ] `kiwi plan` produces a valid TaskGraph against `TaskGraphSchema`
- [ ] `kiwi run` writes a `diff.patch` artifact (git diff or kiwi-format)
- [ ] Required gates produce structured reports under `artifacts/`
- [ ] `safeToApply` is false unless every required gate has a fresh `pass`
      bound to the current diff hash
- [ ] `ReviewVerdict` is structured JSON validated against
      `ReviewVerdictSchema`
- [ ] `final-cost-report.json` reflects real (non-zero) usage when a
      non-stub provider was used
- [ ] `evidence-manifest.json` contains hashes for every artifact

## Reproducibility

The demo run is reproducible on a second machine when:

- The same workspace + ticket + policy is used
- `KIWI_FORCE_ACCESS_MODE` matches between runs
- The same provider tier (model id) is selected (registry order is
  deterministic; resolution depends on which access modes are available)

## Limitations on the demo (not blockers for V1)

- Pre-runner gates (typecheck/lint/test) currently validate the starting
  state of the worktree. Post-runner re-execution against the modified
  worktree is a follow-up (Step 19 hardening backlog).
- Bitbucket PR draft creation is implemented as a contract; the live
  PR-publish flow requires the operator's Bitbucket credentials and is
  not exercised automatically by the demo command sequence.
- Codex CLI, Cursor, and JetBrains adapters are advertised in the
  `accessMode` enum but only `claude-code-cli`, `anthropic-api`, and
  `stub` have provider implementations in this milestone.
