# Production Readiness Plan: App, MCP, and A2A

Status: PROPOSED
Created-Date: 2026-05-04
Depends-On: Steps 01-14 DONE

## Goal

Turn the current MVP-grade local control plane into a production-usable app with reliable CLI operation, MCP parity, and a gated path to A2A.

## Current Baseline

- CLI exists for `init`, `plan`, `status`, `attempt`, `run`, `approve`, `finalize`, and `rules sync`.
- Core has contracts, run store, deterministic planner, provider boundary, scheduler, context packages, quality gates, review verdicts, local-shell runner, sandbox command policy, audit log, and final verdict/cost artifacts.
- MCP exists as a thin JSON-RPC stdio server with resources for runs/task graphs/artifacts and tools for plan/status/run-step/finalize/approval.
- A2A is preparation only: `ProtocolEnvelopeSchema` and readiness notes exist, but no runtime exists.
- Validation observed on 2026-05-04: `pnpm test` and `pnpm typecheck` pass.

## Production Gaps

### P0: Required Before Any Production Use

1. Operator-complete core workflow
   - Add restartable/idempotent flows for retry, cancel, replan, resume, apply, decline, export, and cleanup.
   - Enforce step dependencies before execution. `DONE 2026-05-04`
   - Add run-level locks so two operators or MCP clients cannot mutate one run at the same time. `DONE 2026-05-04`
   - Add a safe final apply flow from sandbox diff to workspace with main-branch guard, backup, and rollback evidence.
   - Acceptance: a user can go from ticket to plan to approval to execution to final apply or decline using CLI only, and the flow survives interruption.

2. Real model provider and review adapters
   - Implement real planner/reviewer providers behind existing contracts, starting with one production target provider.
   - Add prompt templates, prompt versioning, structured output validation, repair/retry, rate-limit handling, and typed provider errors.
   - Replace zero-cost stubs with token and cost accounting from provider responses.
   - Keep stub providers as deterministic test fixtures.
   - Acceptance: real planning and review produce schema-valid artifacts with no raw secrets in prompts, logs, or persisted outputs.

3. Real coding runner adapter
   - Implement at least one real coding runner behind `RunnerAdapter` (`codex`, `claude-code`, or `api`).
   - Normalize runner outputs into patch/diff, raw logs, model usage, and typed failure artifacts.
   - Add streaming/progress capture without bypassing artifact persistence.
   - Acceptance: a runner can make a scoped code change in sandbox, produce a diff artifact, and pass required gates.

4. Sandbox and policy hardening
   - Replace copied-folder isolation with real git worktree or container isolation.
   - Enforce denied paths and approval-required paths against the resulting diff, not only command arguments.
   - Add process-tree cleanup, stronger timeout handling, output limits, and network egress controls.
   - Implement real secret scanning for outputs and diffs.
   - Acceptance: denied paths cannot be changed, high-risk paths require explicit approval, and timed-out work leaves no orphaned process.

5. Quality gates that prove safety
   - Configure real linting; current root `pnpm lint` is only a placeholder.
   - Persist structured reports for typecheck, lint, tests, forbidden-file checks, secret checks, and structured review.
   - Make final verdict depend on evidence-backed gates and review of the actual diff.
   - Acceptance: `safeToApply` cannot be true unless every required gate has fresh evidence and review consumed that evidence.

### P1: Required For A Fully-Fledged Local App

6. MCP production parity
   - Add schema-described tool inputs/outputs for every MCP tool. `INPUT SCHEMAS DONE 2026-05-04`
   - Add resources for run manifest, initiative, planner input/output, attempts, gate results, review verdict, final verdict, cost reports, and audit log. `READ RESOURCE PARITY DONE 2026-05-04`
   - Add MCP tools for retry, cancel, replan, apply, export, and rules sync once CLI equivalents exist.
   - Add protocol conformance tests and client setup docs.
   - Keep all MCP mutations on the same core policy path as CLI.
   - Acceptance: anything operationally supported in CLI is available through MCP without duplicated orchestration logic.

7. Persistence, audit, and compatibility
   - Move schema evolution out of `breaking_allowed`.
   - Add migrations or compatibility readers for old run artifacts.
   - Add a run index for fast listing and recovery checks.
   - Add atomic append/repair behavior for audit logs.
   - Add evidence manifests with hashes for export and review. `DONE 2026-05-04`
   - Acceptance: interrupted or older runs can be recovered or migrated, and exported evidence can be verified locally.

8. Operator app surface
   - Build either a local TUI or local web UI after CLI/MCP parity is stable. `STATIC SNAPSHOT FIRST SLICE DONE 2026-05-04`
   - Required views: run list, TaskGraph, step detail, diff/evidence viewer, approval queue, cost/budget, policy/model settings.
   - The app must consume core/MCP surfaces, not create a second orchestration path.
   - Acceptance: an operator can inspect, approve, retry, finalize, and apply without reading JSON artifacts directly.

### P2: A2A Only After Local Production Stability

9. A2A runtime gate
   - Do not start A2A production runtime until CLI apply/finalize is stable, MCP parity exists, schema compatibility is formalized, and the trust model is documented. `GATED LOOPBACK ONLY DONE 2026-05-04`
   - Define agent identity, capability discovery, auth/trust config, correlation IDs, idempotency keys, replay protection, and streaming status. `IDENTITY/TRUST/CORRELATION/IDEMPOTENCY FIRST SLICE DONE 2026-05-04`
   - Version message schemas for initiative handoff, TaskGraph publication, StepAttempt status, artifact exchange, GateResult, and ReviewVerdict.
   - Require artifact hashes and local gate/review before accepting remote patches. `REMOTE PATCHES BLOCKED 2026-05-04`
   - Acceptance: ai-kiwi can delegate to or consume remote agent work without weakening local policy, audit, or approval gates.

10. Packaging, release, and operations
    - Add release builds, binary/package install path, upgrade path, and smoke tests on a clean machine. `SMOKE/RELEASE CHECK FIRST SLICE DONE 2026-05-04`
    - Add CI for unit, integration, CLI smoke, MCP smoke, migration fixtures, provider fixtures, and sandbox security tests.
    - Document quickstart, provider setup, MCP setup, security model, recovery, and production runbook. `RELEASE/RUNBOOK DRAFTS DONE 2026-05-04`
    - Acceptance: a clean install can initialize a repo, complete a smoke run, expose MCP, and export evidence reproducibly.

## Suggested Sequence

1. Foundation hardening: locks, retries/cancel/replan/apply, real lint/gates, schema compatibility decision.
2. Real AI loop: planner provider, reviewer provider, runner adapter, prompt packaging, cost accounting.
3. Secure execution: real worktree/container, diff-based policy gates, secret scan, rollback/apply flow.
4. MCP parity: schema-described tools/resources, mutation parity, conformance tests, client docs.
5. Local app: TUI or web operator surface on top of CLI/MCP.
6. A2A beta: loopback runtime, trust model, protocol fixtures, remote artifact exchange.

## Production Release Gates

- `pnpm test`, `pnpm typecheck`, and real `pnpm lint` pass.
- CLI smoke covers plan, attempt, approval, finalize, apply, and export.
- MCP smoke covers read resources plus one policy-gated mutation.
- Sandbox security tests cover denied paths, approval paths, secrets, network-disabled behavior, timeout cleanup, and rollback.
- Provider tests cover structured output retry, rate limits, typed failures, and cost accounting.
- Migration fixtures prove older run artifacts can still be read or migrated.
- A2A is disabled by default until protocol conformance, trust, and local-gate enforcement pass.
