# Step 03: Kiwi Init, Config, and Policy Files

Status: TODO
Done-Date: -
Milestone: MVP 1
Depends-On: Step 02
Vision-Refs: 8, 12, 13, 17.1

## Goal

Implement `kiwi init` and the minimum local config files needed for later planning.

## Scope

- Add CLI bootstrap in `apps/cli`.
- Implement `kiwi init`.
- Create default:
  - `.kiwi/config.yaml`
  - `.kiwi/runs/`
  - `kiwi-policy.yaml`
  - `model-registry.yaml`
- Keep initialization idempotent.
- Seed policy defaults for command approval states and risk zones.
- Seed model registry defaults for `cheap`, `mid`, `strong`, and `frontier`.
- Add CLI tests for init behavior.

## Out Of Scope

- `kiwi plan`.
- `kiwi status`.
- Real model routing.
- Execution or sandbox behavior.

## Tasks

- Add command parsing for `kiwi init`.
- Add config writers with safe create/update behavior.
- Avoid overwriting user-edited policy files unless explicitly requested.
- Add deterministic tests using temporary project directories.

## Acceptance Criteria

- `kiwi init` creates all required files and directories.
- Re-running `kiwi init` does not destroy existing user configuration.
- Generated config validates against available config contracts if present.
- CLI exits non-zero for invalid paths or permission failures.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm --filter @ai-kiwi/cli test`
- `pnpm --filter @ai-kiwi/cli typecheck`
