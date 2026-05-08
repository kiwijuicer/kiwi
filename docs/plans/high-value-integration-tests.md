# High-Value Integration Test Plan

Status: PLANNED
Created-Date: 2026-05-08
Scope: local-only integration tests

## Decision

Yes, kiwi needs a small integration test layer.

The current suite covers many packages and CLI command functions, but the product risk is cross-boundary: CLI/MCP entrypoints, workspace resolution, runtime execution, policy gates, review, cost, finalization, and evidence artifacts must agree on the same `.kiwi/runs/<run-id>/` contract.

Keep this to a few hermetic tests. Use temporary git repos, `KIWI_FORCE_ACCESS_MODE=stub`, local `node` commands, no external services, no credentials, no dependency additions, and no approval-requiring paths unless the test is explicitly asserting approval blocking.

## Quality Review

Verdict: PASS.

Rules alignment:
- Local-first constraints are explicit: temp repos, stub model access, local `node` commands, no network services, no credentials, and no dependency additions.
- Safety constraints are respected: denied and approval-required paths appear only in the safety-gate candidate, where blocking is the behavior under test.
- A2A remains frozen: runtime expansion is deferred until Step 22 is done.

Executability and observability:
- Each candidate names a workflow, durable evidence under `.kiwi/runs/<run-id>/`, and a validation outcome.
- Suggested homes use existing colocated Vitest test conventions under `apps/cli/src/__tests__` and `apps/mcp-server/src/__tests__`.
- Defer items are not integration-test candidates for this plan.

Open questions:
- None for this plan.

## Priority 1: CLI Run Evidence Happy Path

Workflow under test:
`kiwi init` -> `kiwi plan --allow-stub` -> `kiwi run --command <local node write>` -> `kiwi diff` -> `kiwi finalize` -> `kiwi evidence manifest` -> `kiwi operator snapshot`.

Expected evidence:
- `.kiwi/runs/<run-id>/run.json`
- `initiative.json`
- `plan/task-graph.json`
- `plan/planner-input.json`
- `plan/planner-output.json`
- `steps/<step-id>/<attempt-id>/attempt.json`
- `steps/<step-id>/<attempt-id>/gate-results.json`
- `steps/<step-id>/<attempt-id>/artifacts/diff.patch`
- `steps/<step-id>/<attempt-id>/artifacts/review-report.json`
- `final/final-summary.md`
- `final/final-verdict.json`
- `final/final-cost-report.json`
- `final/evidence-manifest.json`
- `operator/index.html`

Validation outcome:
The run completes with schema-valid artifacts, the source repo has the expected working-tree change, `kiwi diff` shows the persisted patch, final verdict is safe only when gates pass, and the evidence manifest hashes final/run/step artifacts while excluding transient worktrees.

Suggested home:
`apps/cli/src/__tests__/integration-happy-path.test.ts`

## Priority 2: Workspace Repo Isolation

Workflow under test:
Create a temp workspace with two git repos and a `.code-workspace`; run `kiwi init --workspace`, `kiwi plan --workspace --repo <selected>`, and `kiwi run --workspace --command <local node write>`.

Expected evidence:
- workspace-root `.kiwi/runs/<run-id>/run.json`
- `run.json.workspacePath`
- `run.json.repoId`
- `run.json.repoPath`
- selected repo working-tree diff artifact
- no `.kiwi` directory in the selected repo
- no changed file in the sibling repo

Validation outcome:
The run state is owned by the workspace root, execution targets only the selected repo, and sibling repos are untouched.

Suggested home:
`apps/cli/src/__tests__/integration-workspace-isolation.test.ts`

## Priority 3: Safety Gate Blocks Unsafe Execution

Workflow under test:
Initialize a temp repo with policy deny/approval paths, then attempt a planned step whose command or file target hits a denied path or approval-required path.

Expected evidence:
- blocked or failed `attempt.json`
- `gate-results.json` with `blocked` or `fail`
- command output artifact with the policy reason
- audit event for the block
- no source repo change
- run status stops before finalize can mark the work safe

Validation outcome:
Policy failure cannot be overridden by a positive review, the unsafe command does not mutate the source repo, and the next action is approval/fix/replan instead of continue.

Suggested home:
`apps/cli/src/__tests__/integration-safety-gates.test.ts`

## Priority 4: MCP Parity Flow

Workflow under test:
Use MCP tool calls for `kiwi_plan`, `kiwi_run`, `kiwi_finalize`, `kiwi_evidence_manifest`, and resource reads for the same temp workspace.

Expected evidence:
- tool responses include the run id, workspace path, repo path, completion summary, and next action
- resources expose `task-graph`, `planner-output`, `model-invocations`, final verdict, and evidence manifest
- the same run artifact layout as the CLI happy path

Validation outcome:
MCP produces and reads the same durable run evidence as CLI for the core operator loop, without requiring an IDE, network service, or credentials.

Suggested home:
`apps/mcp-server/src/__tests__/integration-flow.test.ts`

## Priority 5: Cost And Model Evidence Rollup

Workflow under test:
Plan and run a stub-backed local command, then call `kiwi cost --csv` and finalize.

Expected evidence:
- `model-invocations.jsonl` has planner, executor, and reviewer records
- step cost report references executor and reviewer invocations
- final cost report and CSV include one row per invocation
- completion summary total matches the final cost report

Validation outcome:
Operator-facing cost output, final reports, and model invocation ledger stay consistent across plan, run, review, and finalize.

Suggested home:
Extend `apps/cli/src/__tests__/integration-happy-path.test.ts` if it stays readable; otherwise create `integration-cost-evidence.test.ts`.

## Defer

- Live provider runs with Claude/Codex/Cursor CLI: useful smoke checks, not hermetic CI integration tests.
- Bitbucket PR publishing: requires remote auth and should remain a separately approved path.
- A2A runtime coverage beyond loopback/trust checks: A2A is frozen until Step 22 is done.
- Broad snapshot tests of every CLI line: high churn, lower product value than artifact and schema assertions.
