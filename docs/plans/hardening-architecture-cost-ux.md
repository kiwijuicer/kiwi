# Hardening: Architecture, Cost Efficiency, Ease of Use - Index

Status: SPLIT
Created-Date: 2026-05-06
Updated-Date: 2026-05-06

This index file replaces the original consolidated plan. Work is now
split into scope-tight `step-23` to `step-40` files so each item can be
reviewed, executed, and validated in isolation.

## Map of Steps

| Step | Title | Independence | Touches |
| ---- | ----- | ------------ | ------- |
| 23   | Stale ESLint Baseline Cleanup            | Independent                  | `config/eslint-baseline.json`, baseline regen |
| 24   | Centralize JSON IO + Helpers             | Independent                  | `packages/core`, `packages/runtime` |
| 25   | Drop Empty Placeholder Folders           | Independent                  | `packages/core/src/{policy,registry,schemas,storage,graph}` |
| 26   | Canonical ContextPackage in Contracts    | Depends on 24                | `packages/runtime/src/scheduler-types.ts`, `packages/contracts/src/execution.ts` |
| 27   | Capability-aware Executor Selection      | Independent                  | `packages/runtime/src/runner-registry.ts`, `packages/core/src/cost-ledger.ts` |
| 28   | Capability-driven Context Shrink         | Independent                  | `packages/runtime/src/scheduler-policy.ts` |
| 29   | Pre-flight Budget Guard                  | Depends on 27                | `packages/core/src/budget-policy.ts`, `packages/runtime/src/step-attempt-orchestrator.ts` |
| 30   | Reviewer Cache Parity + Prompt Version   | Independent                  | `packages/adapters/src/anthropic-reviewer-provider.ts` |
| 31   | CLI Error Remediation Hints              | Independent                  | `apps/cli/src/commands/register-common.ts`, `apps/cli/src/commands/*` |
| 32   | MCP Server Zod Input Validation          | Independent                  | `apps/mcp-server/src/tools.ts`, `apps/mcp-server/src/tool-definitions.ts` |
| 33   | Live `kiwi tail` + Streaming Output      | Independent                  | `apps/cli/src/commands/tail.ts`, claude/codex/cursor clients |
| 34   | Cost Rollups, Warnings, CSV Export       | Independent                  | `packages/ops/src/run-summary.ts`, `apps/cli/src/commands/cost.ts` |
| 35   | First-class SubPlans in Planner Output   | Independent                  | `packages/core/src/planner.ts`, anthropic planner prompts |
| 36   | Parallel Step Scheduler                  | Depends on 35                | `packages/runtime/src/parallel-scheduler.ts`, `apps/cli/src/commands/run.ts` |
| 37   | Auto-Replan + Auto-Fix-Step              | Independent (best after 35)  | `packages/runtime/src/replanner.ts`, `apps/cli/src/commands/run.ts` |
| 38   | Richer Planner Context (symbols, diff)   | Independent                  | `packages/adapters/src/anthropic-planner-provider.ts` and CLI provider |
| 39   | Researcher Provider                      | Builds on 38                 | `packages/runtime/src/researcher-provider-registry.ts`, prompts |
| 40   | Vite CJS Deprecation Fix                 | Last; decision required      | `**/vitest.config.ts`, root tooling versions |

## Wave Plan

- **Wave 1 (cleanup)**: 23, 24, 25
- **Wave 2 (cost + routing)**: 26, 27, 28, 29, 30
- **Wave 3 (UX + transparency)**: 31, 32, 33, 34
- **Wave 4 (planner + parallel)**: 35, 36, 37
- **Wave 5 (analysis + research)**: 38, 39
- **Wave 6 (tooling)**: 40 (decision gate before execution)

## Working Rules for these Steps

- Backwards compatibility is not required - we are pre-release.
- Unused code can be deleted outright. No deprecation period.
- Each step keeps `pnpm typecheck`, `pnpm lint:eslint`,
  `pnpm lint:baseline`, `pnpm lint:arch`, `pnpm lint:file-size` and
  `pnpm lint:a2a-freeze` green. `pnpm test` and `pnpm lint:deadcode`
  must pass on the developer machine (sandbox here lacks
  `@rollup/rollup-linux-arm64-gnu` and `oxc-resolver` arm64 binaries,
  so those gates run locally).
- ESLint baseline shrinks or stays; new debt is not silently absorbed.
