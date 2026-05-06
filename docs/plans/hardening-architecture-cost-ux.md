# Hardening: Architecture, Cost Efficiency, Ease of Use

Status: DRAFT
Created-Date: 2026-05-06
Author: planner-bot (deep-dive review of branch `hardening`)
Vision-Refs: 2, 3, 5, 9, 10, 11, 12, 13, 14.1, 16
Depends-On: Steps 15-22 (production milestone 1)

> Scope: Re-evaluate the seven product-level goals against the current
> `hardening` branch and define a phased follow-up plan for the items that
> are not yet covered. No code changes are made by this document.

## Seven Goals (verbatim)

1. Code Quality und Architecture on a high level.
2. LLM usage cost efficency as high as possible (costs as low as possible) but keeping point 1 up.
3. Ease of use von kiwi fuer jede Art von Entwickler Level.
4. Analyze, Research, Plan, Split into SubPlans, Execute parallel if possible or squenially with the LLM of choice matching 1. and 2.
5. Good LLMs should make the analisys, plans and reviews of done code.
6. Transperancy in logs to be able to see and analyse the cost efficiency and llm coise.
7. Good UX for the developer in combo with 3.

## Executive Summary

`hardening` already delivers a reproducible TaskGraph -> StepAttempt -> Gate
-> Review -> Finalize loop with provider-neutral interfaces, real Anthropic
and Claude Code CLI integrations, audit + cost ledgers and a deterministic
evidence layout. Goals 1, 5 and 6 are largely covered with concrete
artifacts. Goals 2 and 4 are partially covered: the scheduler decides a
`modelCapability` but the runner registry ignores it, no parallel
SubPlans are produced or executed, and `replan`/`fix_step` are classified
but never acted on. Goal 3 and 7 have a competent CLI baseline but lack
guided onboarding, friendly error remediation and live progress UX.

The plan below is split into four phases and twelve step-sized work
items, each with an acceptance criterion and a `release:check` impact.

---

## 1) Per-Goal Assessment

### Goal 1 - Code Quality and Architecture

**Met**

- Module boundaries enforced by `dependency-cruiser.config.cjs`: no
  apps -> packages backflow, no `core` -> `adapters`/`sandbox`, no
  circular edges, contracts at the bottom.
- Domain values are exported as `as const` unions plus Zod schemas in
  `packages/contracts/src/common.ts` and re-exported through
  `schemas.ts`. Hard-coded canonical literals are blocked by the
  `no-restricted-syntax` rule in `eslint.config.mjs:67-72`.
- Quality net: `pnpm release:check` chains `format:check`, `lint`
  (eslint baseline), `lint:arch`, `code-health` (`file-size`,
  `a2a-freeze`, `knip`, `jscpd`), `typecheck`, `test`, `build`,
  `smoke`. Baselines under `config/eslint-baseline.json` and
  `config/file-size-baseline.json` keep regressions visible.
- StepAttempt is decomposed into focused modules
  (`packages/core/src/step-attempt/{audit,gates,model-cost,persistence,review,runner}.ts`)
  to keep each function small.

**Partial / Gaps**

- Soft size limits exceeded and currently baselined as warnings:
  - `packages/core/src/a2a/runtime.ts` (870 lines) and
    `a2a/common.ts` (390) - frozen by step-22, but counts toward the
    cognitive load.
  - `packages/core/src/scheduler-policy.ts` (542 lines) is close to
    the 600-line soft target.
  - `packages/core/src/planner-run.ts` (`planRun` function ~190
    lines) and `apps/cli/src/commands/init.ts` (344 lines) listed in
    `config/eslint-baseline.json`.
- Duplicated helpers: `writeJsonSafely` is reimplemented in
  `packages/core/src/run-store.ts`,
  `packages/core/src/cost-ledger.ts`,
  `packages/core/src/model-invocations.ts`,
  `packages/core/src/quality-gates.ts`,
  `packages/core/src/scheduler-policy.ts`,
  `packages/core/src/step-attempt-artifacts.ts`,
  `packages/core/src/review-engine.ts`,
  `packages/core/src/lifecycle/files.ts`. Same for `inferAccessMode`
  in `packages/core/src/model-invocations.ts:42` and
  `packages/core/src/run-summary.ts:61`, and for `tryParseJson` in
  `packages/adapters/src/anthropic-common.ts:230`,
  `packages/adapters/src/claude-code-cli/client.ts:35` and
  `.../planner-provider.ts:43`.
- Local types shadow canonical contracts:
  `packages/core/src/scheduler-policy.ts:21-46` redeclares
  `ContextLevel` / `ContextPackage` next to
  `ContextPackageSchema` from
  `packages/contracts/src/execution.ts:122-141`.
- Empty placeholder folders without an index file:
  `packages/core/src/policy`, `graph`, `registry`, `schemas`,
  `storage`. They imply intent but currently invite drift.
- Adapter duplication: `packages/adapters/src/claude-code-cli/{planner-provider,reviewer-provider}.ts`
  reimplement the same `providerError`, `tryParseJson`,
  `previousAttempts`, `RedactedInvocationArtifact` shape; consolidating
  into a shared base would shrink ~100 lines.

### Goal 2 - LLM Cost Efficiency

**Met**

- Capability tiers `cheap | mid | strong | frontier` and budget profiles
  `tiny | small | normal | large | critical` are first-class
  (`packages/core/src/budget-policy.ts:4-10`).
- Scheduler downgrade path under budget pressure
  (`packages/core/src/scheduler-policy.ts:241-262`). Risk overrides
  prevent unsafe downgrades.
- Anthropic pricing table is cache-aware:
  `packages/adapters/src/anthropic-common.ts:203-228` distinguishes
  `cacheWrite`/`cacheRead` from base input tokens for opus / sonnet /
  haiku.
- Planner request enables prompt caching with three `cache_control:
  ephemeral` system blocks
  (`packages/adapters/src/anthropic-planner-provider.ts:158-173`).
- Cost ledger and final report include `usagePrecision` counts so
  `unknown`/`estimated` records are visible
  (`packages/contracts/src/execution.ts:235-264`).

**Partial / Gaps**

- The runner registry's `pickExecutorModel`
  (`packages/runtime/src/runner-registry.ts:135-148`) ignores the
  scheduler's `modelCapability` decision and only ever picks the first
  available `strong || mid` model. Consequence: a step that the
  scheduler downgraded to `cheap` still runs on a `strong` model and
  the budget-aware decision is silently overridden.
- `cheap` is documented as "alias of mid with smaller context budget"
  (`docs/architecture.md:99-100`) but `determineContextLevel`
  (`packages/core/src/scheduler-policy.ts:169-179`) does not actually
  shrink the context level when capability is `cheap`.
- Pre-flight cost guard is absent: `budgetSoftCapExceeded` only feeds
  downgrade logic; there is no "abort attempt before invocation if
  estimated tokens exceed remaining budget" check.
- Codex / Cursor Agent adapters do not surface real cost. The
  cost ledger therefore stores `null` for them and the
  `usagePrecision.unknown` counter grows. There is no warning when
  a final report has high `unknown` share.
- Reviewer prompt caching parity: planner uses three cached system
  blocks; the reviewer path needs verification and equivalent
  cache_control to keep cost down on long diffs.
- No automatic context-level downgrade for `cheap`/`mid` capability:
  the same context budget is computed regardless of selected
  capability, so cheap models receive needlessly large prompts.

### Goal 3 - Ease of Use for any Developer Level

**Met**

- `make install` bootstraps Corepack -> pnpm -> build -> bin wrapper +
  `~/.zshrc` PATH, and is idempotent.
- `kiwi init --mcp <target>` writes Cursor / Claude Code / Codex MCP
  configs (`apps/cli/src/commands/init.ts`).
- `kiwi doctor` (`apps/cli/src/commands/doctor.ts`) probes access
  modes, registry roles, runner availability and is the right
  diagnostic surface.
- Workspace-aware CLI: `kiwi workspace list`, `--workspace`,
  `--repo` everywhere
  (`apps/cli/src/commands/register-core.ts`,
  `apps/cli/src/workspace-options.ts`).

**Partial / Gaps**

- No interactive setup wizard. `kiwi init` writes defaults; users have
  to read `docs/user-guide.md` to know what to do next. There is no
  `kiwi tutorial` / sample ticket / dry-run guide.
- Errors are thrown as plain `Error`s in many command paths
  (`apps/cli/src/commands/run.ts:25-26`, `plan.ts` `NotInitializedError`)
  with no remediation hint pointing at `kiwi init` or `kiwi doctor`.
- `kiwi doctor` is not invoked automatically before `plan` / `run`
  even when the registry has zero available models. The user only
  finds out at execution time.
- The CLI help output does not link back to the doc files
  (`docs/user-guide.md`, `docs/integrations/*.md`).

### Goal 4 - Analyze / Research / Plan / Split / Execute (parallel where possible)

**Met (in part)**

- `Researcher` role + `context_discovery` step type exist in
  `packages/contracts/src/common.ts` and are routed via
  `defaultRouting` in `packages/core/src/planner.ts:127-129`.
- `SubPlanSchema` is defined in
  `packages/contracts/src/domain.ts:38-44` with a `maxConcurrency`
  field and re-exported in `schemas.ts:118`.
- `dependsOn` is honored at execute time
  (`packages/runtime/src/planned-step-execution.ts:50-56`).

**Partial / Gaps**

- No code path constructs `SubPlan`s. `buildDeterministicTaskGraph`
  (`packages/core/src/planner.ts:274-317`) emits `steps` only; the
  `subPlans` field is never populated. The Anthropic planner tool
  schema in `packages/adapters/src/prompts/planner/v1/tool-schema.ts`
  is also flat.
- No parallel executor. `apps/cli/src/commands/run.ts:28-40` executes
  steps in a `for ... of` loop; there is no `Promise.all` over
  independent branches and no `maxConcurrency` enforcement. Repo-wide
  search for `Promise.all`, `parallel`, `concurrency` in
  `packages/` and `apps/` returns zero hits.
- `replan` and `fix_step` next-actions are emitted by
  `packages/core/src/review-engine.ts:115-118` and surfaced in the
  attempt summary, but no replanner re-invokes the planner provider
  with the failing diff and no fix-step injector adds a new step to
  the TaskGraph.
- The `Researcher` role has no provider entry in
  `packages/runtime/src/planner-provider-registry.ts` or a dedicated
  research adapter; it just runs whichever planner/executor the
  capability happens to match.

### Goal 5 - Good LLMs do Analysis, Plans, Reviews

**Met**

- Planner default is `frontier` (Opus 4.6) via
  `defaultRouting` and `kiwi-policy.yaml:routing.stepTypeOverrides`.
- Reviewer defaults to `frontier` for review steps and `strong` for
  validation
  (`packages/core/src/scheduler-policy.ts:264-283`).
- AnthropicPlannerProvider, ClaudeCodeCliPlannerProvider, and the
  matching reviewer providers exist and produce typed retry / repair
  envelopes (`packages/adapters/src/planner-provider.ts:148-215`).

**Partial / Gaps**

- "Analysis" before planning is just a 200-entry depth-2 directory
  listing (`anthropic-planner-provider.ts:102-147`). There is no
  symbol search, no test-file map, no recent-diff context for the
  planner. Planner quality is therefore bounded by repo-skeleton
  context.
- There is no separate Researcher provider that runs cheap context
  discovery before the planner is invoked. The Researcher role is
  defined but unused.
- Reviewer has a `reviewDepth` capability but no capability-distinct
  reviewer prompt (e.g., shallow vs deep review). `reviewDepth`
  currently only feeds the cost-record metadata.

### Goal 6 - Transparency in Logs

**Met**

- Per-event audit log under `.kiwi/logs/audit.log`. Event types
  enumerated in
  `packages/core/src/cost-ledger.ts:6-43` cover planner, reviewer,
  scheduler, gate, runner, lifecycle and a2a flows.
- Per-run JSONL `model-invocations.jsonl`,
  `final/model-usage-summary.json`, `final/final-cost-report.json`,
  per-attempt `cost-report.json`. All schemas in
  `packages/contracts/src/execution.ts:235-317`.
- `kiwi cost`, `kiwi explain`, `kiwi status --json` and the same
  through MCP tools.
- `usagePrecision` counts are persisted in the final cost report
  (`exact / estimated / unknown`).

**Partial / Gaps**

- No `executor_model_selected` audit event. `runner-registry.ts`
  picks an executor model silently; the user cannot see why model X
  beat Y. Compare this with the explicit `planner_provider_selected`
  event in `planner-run.ts:370-381`.
- No "cost by stepId" or "cost by model" rollup. `kiwi explain`
  prints phase totals only (see
  `apps/cli/src/commands/run-summary.ts:23-31`).
- No surface that warns when `usagePrecision.unknown` is dominant -
  the run looks free even though it consumed unknown-cost tokens.
- No CSV/JSON exporter for spreadsheets/BI.
- Prompt-version is captured per artifact but not as an audit event,
  so log-only viewers cannot tell which prompt was billed.

### Goal 7 - Developer UX

**Met**

- Color-coded chalk output, `--json` flags on the read-only commands.
- Stable run ID layout under `.kiwi/runs/<run-id>/` and final
  artifacts (`final-summary.md`, `final-verdict.json`,
  `final-cost-report.json`).
- Operator HTML snapshot via `kiwi operator snapshot`.

**Partial / Gaps**

- No live progress: `kiwi run` blocks until the loop ends. The
  Claude Code CLI client (`packages/adapters/src/claude-code-cli/client.ts`)
  buffers stdout instead of streaming it.
- No `kiwi tail <runId>` to follow the audit log.
- No friendly error suggestions ("did you mean `kiwi init`?",
  "no models available, run `kiwi doctor`").
- MCP tool inputs are JSON-Schema strings, not Zod-parsed at the
  server side (`apps/mcp-server/src/tool-definitions.ts`). Bad inputs
  produce vague errors.
- `kiwi help` shows only commander defaults; no examples.

---

## 2) Phased Plan

### Phase H1 - Architecture cleanup and DRY (Goals 1, 5)

Goal: stop bleeding cognitive load before adding features.

- **H1.1 - Centralize JSON IO and access-mode helpers.**
  Create `packages/core/src/storage/json-io.ts` with
  `writeJsonSafely`, `readJsonOrThrow`, `appendJsonLine`. Replace the
  duplicated copies listed above. Move `inferAccessMode` to
  `packages/core/src/model-invocations-helpers.ts` (or
  `runtime/access-mode-resolver.ts` if that is a better fit). Remove
  the local `ContextPackage`/`ContextLevel` types in
  `scheduler-policy.ts` in favor of the contracts versions.
  - Acceptance: zero new eslint baseline entries; every duplicated
    helper has a single source of truth; `pnpm code-health` stays
    green.
- **H1.2 - Slim scheduler-policy and planner-run.**
  Split `scheduler-policy.ts` into `scheduler/{decide-routing,
  build-context-package, persist-decision, audit}.ts`. Same for
  `planRun` in `planner-run.ts` (`prepare`, `invoke-with-retries`,
  `persist`).
  - Acceptance: every file <= 350 lines, every function <= 120 lines.
    Existing baseline entries for these files removed from
    `config/eslint-baseline.json`.
- **H1.3 - Adapter base class for CLI providers.**
  Extract shared logic from `claude-code-cli/{planner,reviewer}-provider.ts`
  into a `cli-provider-base.ts` that owns `providerError`, retry
  envelope and redaction wrapping. Codex / Cursor providers later
  reuse it.
  - Acceptance: `pnpm lint:duplicates` reports lower clone count;
    line count of the two files reduced by >= 30%.

### Phase H2 - Cost-aware routing and prompt economy (Goals 2, 5, 6)

- **H2.1 - Capability-aware executor selection.**
  Change `pickExecutorModel`
  (`packages/runtime/src/runner-registry.ts:135-148`) to accept the
  scheduler decision's `modelCapability` and return the cheapest
  enabled model whose capability >= decision and whose access mode is
  available. Emit an audit event `executor_model_selected` with
  reason (matched/escalated/fell-back). Wire the event type into
  `cost-ledger.ts` `AuditEventType`.
  - Acceptance: scheduler picks `cheap` -> runner uses Haiku via
    Claude Code CLI when available; downgrade saves are visible in
    `kiwi explain` output and `audit.log`.
- **H2.2 - Pre-flight budget guard.**
  Add `assertWithinBudgetEstimate({budgetProfile,
  remainingUsdEstimate, plannedTokensEstimate, modelId})` in
  `packages/core/src/budget-policy.ts`. Call it from
  `step-attempt-orchestrator.ts` before the runner executes. On
  violation: emit `scheduler_blocked` with reason
  `budget_estimate_exceeds_remaining` and stop the attempt.
  - Acceptance: simulated `tiny` budget run fails fast with a
    structured GateResult instead of burning tokens.
- **H2.3 - Context-level shrink for `cheap`/`mid`.**
  Adjust `determineContextLevel` so capability `cheap` caps at L0 and
  `mid` caps at L1 unless risk-high. Document in `docs/architecture.md`
  table.
  - Acceptance: deterministic test asserts capability `cheap` produces
    L0 and `frontier` keeps L2/L3.
- **H2.4 - Reviewer prompt caching parity.**
  Verify `anthropic-reviewer-provider.ts` system blocks carry
  `cache_control: ephemeral` and that long diff chunks are split so
  cache reuse is high. If absent, add cache control and a recorded
  `prompt_version` audit event per phase.
  - Acceptance: reviewer cost on the demo ticket drops measurably on
    the second invocation; `final-cost-report.json` shows non-zero
    `cacheReadTokens`.

### Phase H3 - First-class SubPlans, replan and parallel execution (Goal 4)

- **H3.1 - Sub-plan-aware planner output.**
  Extend the Anthropic / Claude Code planner tool schemas to include
  optional `subPlans[]` matching `SubPlanSchema`. Update
  `buildDeterministicTaskGraph` to emit a single trivial sub-plan per
  branch when the heuristic finds independent step groups (no shared
  `dependsOn`). Persist `subPlans` in `task-graph.json`.
  - Acceptance: contracts test fixture exercises subPlans with
    `maxConcurrency: 2`; provider replay tests parse and validate the
    new shape.
- **H3.2 - Parallel scheduler.**
  Add `runScheduledSubPlans({cwd, runId, maxGlobalConcurrency})` in
  a new `packages/runtime/src/parallel-scheduler.ts`. Use a small
  worker pool that respects `subPlan.maxConcurrency`,
  step `dependsOn`, and the run lock. Replace the for-loop in
  `apps/cli/src/commands/run.ts` with a wrapper that delegates to the
  parallel scheduler when subPlans exist and falls back to sequential
  otherwise.
  - Acceptance: synthetic plan with two independent sub-plans
    completes in < 1.5x of the slower sub-plan in CI; audit events
    show interleaved attempts.
- **H3.3 - Replanner and fix-step injection.**
  Implement `attemptReplan({cwd, runId, focalStepId, reviewVerdict})`
  that calls the planner with the failing diff + verdict + remaining
  task graph and produces an additive `task-graph.v2.json`. Implement
  `injectFixStep` that appends a `code_modification` step right after
  the failed step when the verdict is `needs_changes`. Wire both into
  `apps/cli/src/commands/run.ts` behind `--auto-replan`/`--auto-fix`
  flags (default off to keep current behaviour stable).
  - Acceptance: e2e fixture where reviewer says `needs_changes` runs
    a follow-up fix-step automatically when `--auto-fix` is set;
    audit log lists `replan_succeeded` or `fix_step_injected`.

### Phase H4 - Onboarding, transparency and live UX (Goals 3, 6, 7)

- **H4.1 - `kiwi setup` wizard.**
  Interactive command that runs `init`, `doctor`, prompts for
  budget/risk profile defaults, suggests an MCP target and prints the
  recommended next command. Re-uses `apps/cli/src/commands/init.ts`
  helpers; no destructive changes.
  - Acceptance: a fresh repo reaches a green `kiwi doctor` after
    `kiwi setup` without reading docs.
- **H4.2 - Friendly error remediation.**
  Add a `mapErrorToHelp` helper in `apps/cli/src/commands/register-common.ts`
  that turns `NotInitializedError`, "no enabled planner model", and
  `RunNotFoundError` into colored hints with the exact next command.
  - Acceptance: known errors print the recovery command in
    `kiwi --help`-style format; integration test snapshots messages.
- **H4.3 - Live status: `kiwi tail <runId>`.**
  Tail `.kiwi/logs/audit.log` filtered by `runId` and pretty-print
  events. Optional `--phase planner|executor|reviewer`.
  - Acceptance: long-running run is observable from a second
    terminal; closes cleanly on Ctrl+C.
- **H4.4 - Cost rollups + warnings.**
  Extend `buildRunCompletionSummary` with `byStep` and `byModel`
  rollups; print a yellow warning when `usagePrecision.unknown >
  total / 4`. Add `kiwi cost --csv` that writes
  `final/final-cost-report.csv`.
  - Acceptance: `kiwi cost <runId> --csv` writes a file with one row
    per invocation; Excel/Numbers can open it.
- **H4.5 - MCP server input validation.**
  Re-use `@kiwi/contracts` Zod schemas to parse incoming MCP tool
  inputs in `apps/mcp-server/src/tools.ts`; surface the parse error
  message to the client.
  - Acceptance: malformed `kiwi_plan` payload returns a structured
    JSON-RPC error with the offending field and a short hint.

---

## 3) Cross-cutting Acceptance Criteria

A change merged under this plan must satisfy all of:

- `pnpm release:check` is green on the affected packages.
- `config/eslint-baseline.json` and `config/file-size-baseline.json`
  shrink (or stay) - new debt is not silently absorbed by the
  baseline.
- `dependency-cruiser.config.cjs` rules are not weakened.
- A2A files remain inside the freeze allowlist
  (`config/a2a-freeze-allowlist.json`) until step 22 is `DONE`.
- Cost-relevant changes ship with at least one regression test that
  asserts both the chosen capability/model and the audit event.
- New CLI surfaces ship with `--json` output and a usage example in
  `docs/user-guide.md`.

## 4) Suggested Sequencing

H1 unblocks H2 (less duplication around cost code), H2 unblocks H3
(routing must respect capability before parallel sub-plans), H4 is
mostly orthogonal and can run in parallel with H2/H3 once the JSON IO
helper is shared.

| Wave | Items                              | Duration estimate |
| ---- | ---------------------------------- | ----------------- |
| 1    | H1.1, H1.2, H4.1, H4.2             | small             |
| 2    | H1.3, H2.1, H2.3, H4.3             | small             |
| 3    | H2.2, H2.4, H4.4, H4.5             | medium            |
| 4    | H3.1, H3.2, H3.3                   | medium-large      |

## 5) Validation Steps for this Plan

- `pnpm test` and `pnpm typecheck` remain green at plan-time.
- Each phase carries its own acceptance test before moving on.
- `kiwi explain <run-id>` and `kiwi cost <run-id> --csv` reproduce
  the chosen models per phase to prove goals 2, 5 and 6.
- A demo run on a `tiny` budget proves the pre-flight guard, the
  capability-aware executor selection and the audit transparency.

## 6) Open Questions

- Does the project want `--auto-replan`/`--auto-fix` on by default
  once stable, or always opt-in?
- Should `cheap` remain an alias of `mid` (current contract) or
  become a real tier with its own pricing in
  `packages/adapters/src/anthropic-common.ts:priceForModel`?
- Parallel execution: stay node-process-internal worker pool, or
  prefer git-worktree per worker so artifacts stay isolated? The
  sandbox already supports per-attempt worktrees
  (`packages/sandbox/src/worktree.ts`), which makes the second
  option close to free.

