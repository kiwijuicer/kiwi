# kiwi Vision

Local-first AI coding control plane for planned, safe, auditable coding work.

Version: 0.3
Status: Current product direction
Primary stack: TypeScript, pnpm, Zod, CLI-first, MCP-enabled

## Summary

`kiwi` turns a human ticket or task into a structured TaskGraph, executes planned
Steps through local authenticated runners, and persists every decision, cost,
diff, gate, review, and final artifact under `.kiwi/runs/<run-id>/`.

The CLI is the reference operator surface. MCP exposes the same behavior to IDEs
and assistants with explicit preview and approval boundaries.

## Product Goals

- Produce reproducible TaskGraphs from vague or concrete task input.
- Execute planned Steps safely in a local workspace or selected repo.
- Keep planning, execution, review, gates, and publishing as inspectable stages.
- Route work by `agentRole`, `modelCapability`, policy, risk, budget, and runner availability.
- Persist audit evidence, model usage, cost summaries, diffs, and final verdicts.
- Support single-repo and multi-repo workspaces without global services.
- Keep credentials outside Core and run artifacts.
- Support provider-neutral SCM flows, with Bitbucket PR draft publishing implemented first.

## Non-Goals

- No autonomous end-to-end coding without gates.
- No hosted multi-tenant backend requirement.
- No dashboard requirement for the current milestone.
- No active agent-to-agent handoff protocol.
- No storage of SCM or model provider credentials in Core.

## Operating Principles

- Local-first by default.
- CLI behavior is canonical; MCP is an access channel.
- Policy before execution.
- Risk beats budget.
- Deterministic artifacts before summary text.
- Explicit contracts at package boundaries.
- Small planned Steps over large opaque changes.
- No staging, commits, tags, or pushes unless the user explicitly asks.

## Canonical Domain Model

These terms are shared across contracts, CLI, MCP, artifacts, and docs.

### Initiative

The incoming task or ticket.

Key fields:

- `id`
- `title`
- `rawInput`
- `source`
- `repoPath`
- `riskProfile`
- `budgetProfile`
- `createdAt`

### Run

A concrete orchestration of an Initiative.

Runs are stored under:

```text
<workspace>/.kiwi/runs/<run-id>/
```

Key fields:

- `runId`
- `initiativeId`
- `currentPlanId`
- `status`
- `workspacePath`
- `repoId`
- `repoPath`
- `createdAt`
- `updatedAt`

### TaskGraph

A machine-readable plan for the Run.

Key fields:

- `planId`
- `runId`
- `initiativeId`
- `summary`
- `steps[]`
- `subPlans[]`
- `acceptanceCriteria[]`
- `assumptions[]`
- `openQuestions[]`
- `riskScore`
- `complexityScore`
- `createdAt`

### Step

A logical unit of work in a TaskGraph.

Key fields:

- `stepId`
- `type`
- `title`
- `dependsOn[]`
- `successCriteria[]`
- `requiredGates[]`
- `recommendedAgentRole`
- `recommendedModelCapability`
- `status`

### StepAttempt

One concrete execution attempt for a Step.

Key fields:

- `attemptId`
- `stepId`
- `runner`
- `agentRole`
- `modelCapability`
- `status`
- `contextPackageRef`
- `modelInvocationRefs[]`
- `artifacts[]`
- `startedAt`
- `completedAt`

### Artifact

A persisted output from planning, execution, review, evidence, or publishing.

Common artifact refs include:

- planner input and output
- context package
- command output
- diff patch
- gate results
- review report
- cost report
- final summary
- final verdict
- evidence manifest
- operator snapshot
- PR draft

### GateResult

The structured result of a quality, policy, or safety gate.

Key fields:

- `gateId`
- `gateType`
- `status`
- `evidenceRefs[]`
- `reason`
- `subject`

### ReviewVerdict

The structured review result.

Key fields:

- `verdict`
- `safeToContinue`
- `issues[]`
- `recommendedNextSteps[]`
- `confidence`
- `subject`

## Roles And Model Capability

`agentRole` describes function. `modelCapability` describes expected capability
and cost tier.

Agent roles:

- `planner`
- `researcher`
- `executor`
- `reviewer`
- `security`
- `rules`

Model capabilities:

- `cheap`
- `mid`
- `strong`
- `frontier`

Default intent:

- Planning: `planner` + `frontier`
- Risk-sensitive review: `reviewer` + `frontier`
- Normal coding: `executor` + `strong`
- Tests, docs, rules, and SCM draft work: usually `mid`

## Current Execution Model

Kiwi is Codex-first by default:

- `kiwi init` writes shared defaults under `~/.kiwi/defaults/`.
- The default registry routes through local CLI access modes only.
- Codex CLI models are selected explicitly through `providerModel` and passed to the runner.
- Claude Code CLI and Cursor Agent CLI are fallback local access modes when configured.
- Stub models are for tests and development only.

Execution defaults to direct mode in the selected repo working tree. Direct mode
is guarded by policy, git state checks, command profiles, diff capture, and
review gates. Set `KIWI_EXECUTION_ISOLATION=worktree` to use isolated worktrees.

MCP mutating calls require a fresh preview token from `kiwi_preview_run`. The
token binds the selected run, execution options, repo state, policy, and planned
Steps so assistants cannot skip the decision preview.

## Safety Model

Default safety constraints:

- No direct writes on protected-looking branches.
- No execution with dirty tracked files or untracked non-Kiwi files in direct mode.
- No commits, staging, tags, or pushes without explicit user request.
- No dependency additions, migrations, production config changes, or unrestricted shell without approval.
- No secrets in prompts, logs, or run artifacts.
- No SCM or model credentials in Core.

Approval states:

- `auto`: policy allows continuation.
- `required`: human approval evidence is required.
- `blocked`: policy prohibits continuation.

## Integrations

- CLI: primary operator surface.
- MCP stdio and HTTP: IDE and assistant access channel.
- SCM adapters: provider-neutral boundary, with Bitbucket PR draft publishing available.
- Operator artifacts: local HTML snapshot, evidence manifest, final summaries, and cost reports.

## Future Scope

Agent-to-agent handoff remains out of active scope. Any future interop channel
requires a new ADR, explicit contracts, and local gate semantics before
implementation.
