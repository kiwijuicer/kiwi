# Step 13: MCP, Rules Sync, and Operator Surfaces

Status: DONE
Done-Date: 2026-05-04
Milestone: MVP 5+
Depends-On: Step 12
Vision-Refs: 14, 16, 17.5

## Goal

Add post-MVP orchestration surfaces once CLI-first flows are stable.

## Scope

- Implement `apps/mcp-server` as an integration channel.
- Keep CLI as the reference flow.
- Expose read-only run, plan, status, evidence, and review endpoints first.
- Add controlled action endpoints only after policy checks exist.
- Add optional rules sync generation for `.cursor/rules/*.mdc`.
- Evaluate dashboard or TUI needs after stable CLI behavior.
- Keep MCP thin over `packages/core`; do not duplicate orchestration.

## Out Of Scope

- MCP as the primary orchestrator.
- Multi-tenant SaaS backend.
- A2A runtime.
- Skipping CLI parity.

## Tasks

- Define MCP server contracts around existing core APIs.
- Add read-only tools/resources for runs and plans.
- Add policy-gated mutation commands where safe.
- Add tests for MCP behavior and CLI parity.
- Add optional rules sync command if rules format is stable.

## Acceptance Criteria

- MCP exposes existing orchestration state without duplicating orchestration logic.
- Mutating operations respect the same policies as CLI commands.
- Rules sync is generated from canonical rule files, not hand-maintained duplicates.
- CLI remains complete enough to operate the system without MCP.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @kiwi/mcp-server test`
- `pnpm test`
- `pnpm typecheck`
