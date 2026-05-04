# Plans Index

Status source of truth: each `step-*.md` file header.

When a step is implemented and validated, update its header:

```md
Status: DONE
Done-Date: YYYY-MM-DD
```

## Compatibility Policy

- For Steps 01-14, backward compatibility is not required.
- Prefer clear contracts and simple refactors over compatibility layers.
- Add BC constraints only after explicit decision in a later milestone.

## Execution Order

- Step 01: Clean Start and Repo Baseline
- Step 02: Contracts and Domain Schemas
- Step 03: Kiwi Init, Config, and Policy Files
- Step 04: Run Store and Artifact Layout
- Step 05: Deterministic Planner and Plan Command
- Step 06: Status Command and MVP1 Hardening
- Step 07: Planner Provider Boundary
- Step 08: Provider Retries and Cost Ledger
- Step 09: Quality Gates and Review Engine
- Step 10: Scheduler Policy and Context Packaging
- Step 11: Worktree Sandbox and Command Execution
- Step 12: Runner Adapters and Step Orchestration
- Step 13: MCP, Rules Sync, and Operator Surfaces
- Step 14: A2A Preparation and Future Scale
- Step 15: Scope Freeze and Model Tier Collapse
- Step 16: Anthropic Planner Provider
- Step 17: Anthropic Reviewer Provider
- Step 18: Claude Code Runner Adapter
- Step 19: Real Quality Gate Execution
- Step 20: Git Worktree Sandbox Hardening
- Step 21: Install and Distribution Hygiene
- Step 22: End-to-End Real Run Demo

## Milestone Mapping

- MVP 1: Steps 01-06
- MVP 2: Steps 07-08
- MVP 3: Steps 09-10
- MVP 4: Steps 11-12
- MVP 5+: Steps 13-14
- Production Milestone 1 (Real Loop): Steps 15-22

## Scope Freeze During Production Milestone 1

While Steps 15-22 are open, the following are explicitly frozen and must not be extended:

- A2A runtime (`packages/core/src/a2a-runtime*.ts`, `apps/cli/src/commands/a2a.ts`, A2A MCP tools).
- Operator UI surfaces beyond the existing static snapshot.
- GitHub SCM adapter parity work (Bitbucket Cloud remains the demo target).

The freeze lifts when Step 22 is `DONE`.

## Post-MVP Production Plan

- `docs/plans/production-readiness-mcp-a2a.md`
- `docs/plans/production-milestone-1-real-loop.md`
