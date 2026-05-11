# kiwi Architecture

## Scope

Dieses Dokument konkretisiert `docs/vision.md` fuer die aktuelle Codebasis.
Stand: Production Milestone 1 (Real Loop) — echte Provider- und Runner-Integration aktiv.

## Architektur-Ueberblick

```mermaid
flowchart TD
  input[TicketInput] --> cli[apps/cli]
  cli --> runtime[packages/runtime]
  runtime --> core[packages/core]
  runtime --> adapters[packages/adapters]
  runtime --> sandbox[packages/sandbox]
  core --> contracts[packages/contracts]
  adapters --> contracts
  sandbox --> contracts
  core --> runstore[.kiwi/runs/<run-id>/]
  cli --> policy[.kiwi/policy.yaml]
  cli --> registry[.kiwi/model-registry.yaml]
```

## Module

- `apps/cli`
  - Kommandos: `init`, `plan`, `run`, `attempt`, `finalize`, `status`, `cost`, `doctor`,
    `evidence`, `explain`, `operator`, `publish`, `rules`, `run-summary`, `subplan-tree`,
    `workspace`, `approve`, `a2a` (frozen)
  - laedt Policy/Registry
  - loest Provider und Access Mode auf und delegiert an runtime
- `packages/core`
  - Initiative creation
  - deterministic TaskGraph builder
  - Run persistence im Ziel-Layout
  - status aggregation
- `packages/contracts`
  - kanonische Zod-Schemas und Domain Types
  - zentrale Begriffe fuer Initiative/Run/TaskGraph
- `packages/runtime`
  - Composition Layer fuer CLI/MCP executable flows
  - loest Provider, Access Modes und Runner auf
  - verbindet Core, Adapters und Sandbox ohne eigene Persistenzhoheit
- `packages/adapters`
  - Provider-, Runner- und SCM-Adapter hinter stabilen Interfaces
- `packages/sandbox`
  - Worktree Lifecycle, Command Policy, Prozessausfuehrung und Diff-Capture

## Persistenzlayout

```text
.kiwi/
  config.yaml
  policy.yaml
  model-registry.yaml
  runs/
    <run-id>/
      run.json
      initiative.json
      plan/
        task-graph.json
```

## Dependency Rules

- `apps/*` duerfen von `packages/*` abhaengen.
- `packages/core` darf nur gegen `packages/contracts` sprechen.
- `packages/runtime` darf `core`, `contracts`, `adapters` und `sandbox`
  komponieren, besitzt aber keine kanonischen Contracts und keine
  Provider-spezifische Logik.
- Contracts enthalten keine runtime side effects.
- Provider-/Runner-Integrationen gehoeren in `packages/adapters`.

## A2A Freeze

Bis `docs/plans/step-22-end-to-end-real-run-demo.md` `Status: DONE` ist,
bleibt A2A eingefroren. Erlaubt sind nur mechanische Move-/Import-Updates, die
vom A2A-Freeze-Gate akzeptiert werden. Neue A2A-Kommandos, Runtime-Semantik,
Payload-Arten oder Trust-Regeln sind nicht in Scope.

## Model Tier Mapping

Capability tiers in `.kiwi/model-registry.yaml` map to explicit Codex CLI
models by default. Kiwi passes the selected `providerModel` to Codex CLI with
`--model` for every planned step, so model switching is enforced by the runner
instead of left to Codex defaults. Direct provider API keys are not required for
daily use.

| Capability | Default Local Access | Notes                            |
| ---------- | -------------------- | -------------------------------- |
| frontier   | codex-cli gpt-5.5    | planner, high-risk reviewer      |
| strong     | codex-cli gpt-5.4    | default coding, default reviewer |
| mid        | codex-cli gpt-5.4-mini | tests, docs, rules, research   |
| cheap      | codex-cli gpt-5.4-mini | smaller context / lower-cost routes |

Execution defaults to the current repo working tree with Codex CLI
`workspace-write` sandboxing. Kiwi invokes Codex with
`approval_policy="on-request"` and `approvals_reviewer="auto_review"`, so
eligible approval requests are reviewed by Codex auto-review instead of bypassed.
`KIWI_EXECUTION_ISOLATION=worktree` keeps the old isolated worktree path as an
explicit safety override.

## Prompt Cache Parity Note

Anthropic API planner/reviewer calls use three cached system blocks to maximize
prompt prefix reuse. CLI access modes (`claude-code-cli`) currently pass a
single monolithic `--system-prompt`, so cache reuse and prompt-version tracing
are weaker there by design.

## Capability-to-Context-Level Caps

Scheduler context level selection applies the following caps before packaging
context for non-risk-high routes:

| Model Capability | Non-Risk Max Context Level | Risk-High Override |
| ---------------- | -------------------------- | ------------------ |
| cheap            | L0                         | risk rules may raise to L2/L3 |
| mid              | L1                         | risk rules may raise to L2/L3 |
| strong           | context-size driven (L0-L2) | risk rules may raise to L2/L3 |
| frontier         | context-size driven (L0-L2) | risk rules may raise to L2/L3 |

## Tier-to-Step-Type Defaults

The scheduler picks `agentRole` and `modelCapability` from the policy
`stepTypeOverrides`. Defaults below match `.kiwi/policy.yaml` and the
defaults written by `kiwi init`. Risk zones from `riskZones.high` may
escalate execution and review tiers; downgrading for security-sensitive
steps is not allowed.

| Step Type           | Agent Role | Model Capability |
| ------------------- | ---------- | ---------------- |
| planning            | planner    | frontier         |
| review              | reviewer   | frontier         |
| validation          | reviewer   | strong           |
| coding              | executor   | strong           |
| code_creation       | executor   | strong           |
| code_modification   | executor   | strong           |
| refactoring         | executor   | strong           |
| test_creation       | executor   | mid              |
| documentation       | executor   | mid              |
| rules_update        | executor   | mid              |
| scm_ticket          | executor   | mid              |
| scm_pull_request    | executor   | mid              |
| scm_review          | executor   | mid              |
