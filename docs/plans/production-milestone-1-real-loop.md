# Production Milestone 1: Real Loop

Status: DONE
Done-Date: 2026-05-04
Created-Date: 2026-05-04
Targets: Steps 15-22
Depends-On: Steps 01-14 DONE

> Architectural pivot landed mid-milestone: API keys are not the default
> path. `accessMode` is a first-class concept in `model-registry.yaml`,
> and the runtime resolves the best available access mode per
> invocation. Claude Code CLI is the preferred default; direct
> Anthropic/OpenAI APIs are opt-in. Cost evidence distinguishes exact /
> estimated / unknown precision so CLI/IDE invocations are auditable
> without faking zero-cost. See `docs/ops/real-run-demo.md`.

## Goal

Replace the stub-driven Plan/Run/Review loop with a real, end-to-end Anthropic-backed loop, gated by real evidence and real isolation, without expanding scope into A2A or operator UI.

## Why This Milestone Exists

The control plane (contracts, run store, scheduler, sandbox harness, MCP server, evidence manifest) is implemented and tested. The product gap is functional, not architectural: every model-facing surface is a stub, and the sandbox is a copy-folder, not a worktree. Until that gap closes, kiwi cannot produce a single real change. This milestone closes it with the smallest defensible scope.

## Out Of Scope For This Milestone

- A2A runtime extensions. Frozen by Step 15.
- Codex and generic API runner adapters beyond Claude Code.
- Operator TUI/Web UI.
- GitHub adapter parity work.
- Multi-tenant or remote backend.

## Sequence

1. Step 15: Scope Freeze and Model Tier Collapse
2. Step 16: Anthropic Planner Provider
3. Step 17: Anthropic Reviewer Provider
4. Step 18: Claude Code Runner Adapter
5. Step 19: Real Quality Gate Execution
6. Step 20: Git Worktree Sandbox Hardening
7. Step 21: Install and Distribution Hygiene
8. Step 22: End-to-End Real Run Demo

Steps 16, 17, 19, 20, 21 can run in parallel where capacity allows. Step 18 depends on 16 (prompt envelope reuse). Step 22 depends on 16-20.

## Suggested Timeline

- Week 1: Step 15 + start Step 16.
- Week 2: Finish Step 16; Step 17; start Step 18.
- Week 3: Finish Step 18; Step 19; start Step 20.
- Week 4: Finish Step 20; Step 21; Step 22 acceptance demo.

## Milestone Acceptance

A single real ticket against a real Bitbucket repo runs end-to-end with no human intervention between phases:

- `kiwi plan` produces a TaskGraph from a real Anthropic planner with token and cost evidence.
- `kiwi run` executes coding steps via `ClaudeCodeRunnerAdapter` in a real `git worktree`.
- Real typecheck, lint, and test gates execute in the sandbox and persist structured reports.
- A real Anthropic reviewer issues a `ReviewVerdict` against the diff, not the full files.
- `kiwi finalize` applies the diff to a feature branch and `kiwi evidence manifest` produces a hash-verified manifest.
- The Bitbucket adapter posts a PR draft.
- `pnpm release:check` passes from a clean checkout.

## Non-Negotiables

- No raw secrets in prompts, logs, persisted artifacts, or audit events.
- No write to `main` under any flag.
- No bypass of `requiredGates` from `safeToApply`.
- No A2A code path is exercised by this milestone.
- No regression in CLI/MCP parity established by Step 13.

## Risks

- Real provider latency and rate limits change scheduler assumptions. Mitigation: keep stub providers in the test path, never in the default.
- Worktree teardown can leak on crash. Mitigation: orphan reaper on `kiwi init` and `kiwi run` startup.
- Real costs make budget profiles meaningful. Mitigation: surface budget exhaustion as a typed scheduler decision, not a silent downgrade.
- Provider prompt drift across releases. Mitigation: prompt versioning baked into Step 16.

## Exit

This milestone is complete when Step 22 is `DONE` and the demo run is reproducible by a second operator on a clean machine.
