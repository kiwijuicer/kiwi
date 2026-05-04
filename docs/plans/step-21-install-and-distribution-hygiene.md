# Step 21: Install and Distribution Hygiene

Status: DONE
Done-Date: 2026-05-04
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 15
Vision-Refs: 14.1, 17.5

> Implementation note: Makefile rewritten so the installed `kiwi`
> wrapper does not run `pnpm` at invocation time — it execs
> `apps/cli/dist/index.js` directly and emits a clear error if the build
> artifact is missing. `kiwi --version` reads `KIWI_BUILD_SHA` injected
> by `make install` (git short-sha at build time).

## Goal

Eliminate the rebuild-on-every-run wrapper and provide a clean install path so `kiwi` starts in under one second on a warm machine and ships as a versioned artifact.

## Scope

- Replace the current `Makefile install` wrapper that runs `pnpm --filter @kiwi/cli build` and `pnpm --filter @kiwi/mcp-server build` on every invocation. The installed `kiwi` script must execute `apps/cli/dist/index.js` directly.
- Add a `make build` step that the install path depends on; the wrapper assumes `dist/` is present and exits with a clear message if it is not, instead of silently rebuilding.
- Pin the wrapper to a release-tagged commit reference (or a git short-sha at install time) and emit it via `kiwi --version`.
- Add `make uninstall` parity for the MCP server installation hooks that `kiwi init` writes.
- Create a smoke fixture under `scripts/smoke.mjs` that runs against a temporary git repo:
  - `kiwi init`
  - `kiwi plan` against an inline ticket using the stub planner (real provider is exercised in Step 22)
  - `kiwi status`
  - `kiwi finalize` happy path
- Document the install/uninstall flow and required environment in `docs/ops/release.md`.

## Out Of Scope

- npm registry publication or homebrew/scoop distribution.
- Auto-update mechanism.
- Containerized install.

## Tasks

- Rewrite the `kiwi` shell wrapper produced by `make install` to be a thin exec call without `pnpm` invocations.
- Add a preflight check in the wrapper that verifies the expected `dist/index.js` exists and prints an actionable error otherwise.
- Wire `kiwi --version` to a value injected at build time (read `package.json` version + git short-sha).
- Move `make install` to depend on `make build`. Document `make install INSTALL_DEPS=0 BUILD=0` opt-out for fast iteration.
- Add `scripts/smoke.mjs` and wire it into `pnpm release:check`.
- Update `README.md` and `docs/ops/release.md` to reflect the new flow.

## Acceptance Criteria

- `kiwi --version` prints a versioned identifier including git short-sha.
- A warm `kiwi status` invocation completes in under one second.
- `make install` builds once; subsequent `kiwi` invocations do not run `pnpm`.
- `pnpm release:check` succeeds on a clean checkout including the new smoke step.
- `make uninstall` removes the `kiwi` binary and any MCP client config files written by `kiwi init`.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm release:check`
- Manual: `make install && kiwi --version && time kiwi status`
- Manual: `make uninstall` leaves no `kiwi` binary on `PATH`
