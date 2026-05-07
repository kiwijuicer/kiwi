# Plans Index

Status source of truth: each `step-*.md` file header.

When a step is implemented and validated, update its header:

```md
Status: DONE
Done-Date: YYYY-MM-DD
```

Completed step files are deleted after validation. Only open/planned steps remain in this folder.

## Compatibility Policy

- For Steps 01-22, backward compatibility is not required.
- Prefer clear contracts and simple refactors over compatibility layers.
- Add BC constraints only after explicit decision in a later milestone.

## Milestone Overview

| Milestone | Steps | Status |
|---|---|---|
| MVP 1 | 01-06 | ✅ DONE |
| MVP 2 | 07-08 | ✅ DONE |
| MVP 3 | 09-10 | ✅ DONE |
| MVP 4 | 11-12 | ✅ DONE |
| MVP 5+ | 13-14 | ✅ DONE |
| Production Milestone 1 (Real Loop) | 15-22 | ⚠️ PARTIAL (Step 22 blocked) |
| Hardening: Architecture, Cost, UX | 23-40 | 🔄 IN PROGRESS |

## Open Steps (Hardening Milestone)

Steps with their own file are still open. Steps without a file are DONE and deleted.

- Step 26: Canonical ContextPackage in Contracts — `step-26-canonical-context-package.md`
- Step 29: Preflight Budget Guard — `step-29-preflight-budget-guard.md`
- Step 30: Reviewer Cache Parity — `step-30-reviewer-cache-parity.md`
- Step 31: CLI Error Remediation — `step-31-cli-error-remediation.md`
- Step 32: MCP Zod Validation — `step-32-mcp-zod-validation.md`
- Step 33: CLI Tail and Stream — `step-33-cli-tail-and-stream.md`
- Step 34: Cost Rollups — `step-34-cost-rollups.md`
- Step 35: Subplans First-Class — `step-35-subplans-first-class.md`
- Step 36: Parallel Scheduler — `step-36-parallel-scheduler.md`
- Step 38: Richer Planner Context — `step-38-richer-planner-context.md`
- Step 39: Researcher Provider — `step-39-researcher-provider.md`
- Step 40: Vite CJS Fix — `step-40-vite-cjs-fix.md` *(Decision required before execution)*

## A2A Freeze

A2A runtime is frozen until Step 22 is `DONE`. The following paths must not receive new behavior:

- `packages/core/src/a2a-runtime*.ts`
- `apps/cli/src/commands/a2a.ts`
- `apps/cli/src/commands/register-a2a.ts`
- `packages/contracts/src/a2a.ts`

The freeze is enforced by `scripts/check-a2a-freeze.mjs`. It lifts when `step-22-end-to-end-real-run-demo.md` exists with `Status: DONE`.

## Active Milestone Reference

- `docs/plans/production-milestone-1-real-loop.md` — Step 22 acceptance criteria and blocking status
