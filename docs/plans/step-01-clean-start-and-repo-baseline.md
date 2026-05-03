# Step 01: Clean Start and Repo Baseline

Status: DONE
Done-Date: 2026-05-03
Milestone: MVP 1
Depends-On: -
Vision-Refs: 15, 17.1, 18

## Goal

Establish the clean monorepo baseline for `ai-kiwi` without implementing product behavior yet.

## Scope

- Preserve `AGENTS.md`, `docs/vision.md`, `docs/rules/*`, and Git history.
- Create or normalize the target repo structure:
  - `apps/cli`
  - `apps/mcp-server`
  - `packages/contracts`
  - `packages/core`
  - `packages/adapters`
  - `packages/sandbox`
- Add root workspace config for TypeScript and pnpm.
- Add minimal package metadata and build/test script placeholders.
- Keep `.kiwi` runtime artifacts out of source control.

## Out Of Scope

- CLI commands.
- Domain schemas.
- Planning logic.
- Provider, runner, sandbox, MCP, dashboard, or A2A behavior.

## Tasks

- Review existing files and remove or isolate legacy implementation that conflicts with the vision.
- Add `pnpm-workspace.yaml`, root `package.json`, and `tsconfig.base.json`.
- Add package-level `package.json` and `tsconfig.json` files.
- Add initial test framework config.
- Add ignore rules for generated run artifacts.

## Acceptance Criteria

- Workspace installs and resolves all local packages.
- Empty package builds or no-op checks run consistently.
- Target folder structure matches `docs/vision.md`.
- No runtime `.kiwi/runs/*` artifacts are committed.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
