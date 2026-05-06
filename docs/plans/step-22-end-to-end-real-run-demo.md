# Step 22: End-to-End Real Run Demo

Status: PARTIAL
Blocked-Reason: Live run and Bitbucket PR evidence still require operator credentials and target repo.
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Steps 16, 17, 18, 19, 20
Vision-Refs: 4.9, 11, 12, 14.4, 17.5, 20

> Implementation note: end-to-end demo machinery is in place, but the live
> Bitbucket run has not produced PR evidence yet. Local CLI auth is preferred
> (`claude`, `codex`, or `cursor-agent` runner support); direct API keys
> are not required for the daily-use flow. The demo command sequence and acceptance checklist live in
> `docs/ops/real-run-demo.md`. `kiwi doctor` introspects the workspace and
> reports which access modes are usable.

> A2A freeze: until this file is marked `Status: DONE`, A2A behavior is frozen.
> Only mechanical import/move updates required by non-A2A refactors are allowed,
> and `pnpm lint:a2a-freeze` enforces the current allowlist.

## Goal

Prove the milestone end-to-end with a single real run: from a Bitbucket ticket to a Bitbucket pull request draft, no human intervention between phases, with real model providers, real worktree, real gates, and a verifiable evidence manifest.

## Scope

- Pick a representative low-risk ticket inside a real Bitbucket Cloud repo (a small bug fix or doc update is sufficient).
- Default demo target: a separate Bitbucket Cloud repo named `kiwi-step22-demo`
  with a docs-only ticket such as `docs/kiwi-demo-proof.md`.
- Drive the full flow via CLI only:
  1. `kiwi init --workspace <ws>`
  2. `kiwi plan ./ticket.md --workspace <ws> --repo <id>` using `AnthropicPlannerProvider`
  3. `kiwi run <run-id>` executing coding steps via `ClaudeCodeRunnerAdapter` in a `git worktree`
  4. Real `typecheck`, `lint`, `tests`, `forbidden_file_checks`, `secrets_check` gates pass with structured reports
  5. `AnthropicReviewerProvider` produces a `ReviewVerdict` against the diff artifact
  6. `kiwi finalize <run-id>` applies the diff to a feature branch and writes `final-summary.md`, `final-verdict.json`, `final-cost-report.json`
  7. `kiwi evidence manifest <run-id>` writes a hash-verified evidence manifest
  8. Bitbucket adapter posts a PR draft pointing at the feature branch
- Persist the run as a fixture under `docs/plans/demo-run/` so a second operator can reproduce it.
- Capture the demo run-id, the diff, the evidence manifest, the cost report, and the PR URL in a short `docs/ops/real-run-demo.md`.

## Out Of Scope

- A2A delegation of any step.
- GitHub adapter parity for this demo.
- Operator UI surfaces.
- Runner adapters other than locally available CLI runners.

## Tasks

- Select a candidate ticket and target repo. Keep it outside `riskZones.high`.
- Configure `.kiwi/policy.yaml` for the target workspace; verify denied paths and approval-required paths.
- Run the demo end-to-end without manual editing of artifacts.
- Verify evidence manifest hashes match the persisted artifacts.
- Capture metrics: total wall time, total token cost, planner cost, reviewer cost, runner cost, gate wall time, retry count.
- Write `docs/ops/real-run-demo.md` summarizing the run and how to reproduce it.

## Acceptance Criteria

- A single command sequence runs from `kiwi plan` to PR draft without human edits to artifacts or prompts.
- Every required gate has a fresh `pass` evidence artifact tied to the same diff hash that the reviewer consumed.
- `safeToApply` is `true` only after all gates and review reference the same diff hash.
- Total run cost is recorded in `final-cost-report.json` from real provider usage; no zero-cost stubs are exercised.
- The PR draft exists in the target Bitbucket repo and references the feature branch and the evidence manifest path.
- Reproducing the demo on a second machine produces a structurally equivalent evidence manifest (same artifact set; hashes differ only where deterministic by content).
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm release:check`
- Manual: documented demo command sequence executes cleanly on a clean checkout.
- Manual: PR draft URL is reachable in Bitbucket Cloud.
