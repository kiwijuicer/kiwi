# Release Checklist

Status: draft

## Release Gate

Run before tagging or packaging:

```bash
pnpm release:check
```

This runs:

- `pnpm format:check`
- `pnpm lint` (`lint:eslint` + `lint:baseline`)
- `pnpm lint:arch` (dependency-cruiser)
- `pnpm code-health` (`lint:file-size`, `lint:deadcode`, `lint:duplicates`)
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke`

## Smoke Coverage

`pnpm smoke` creates a clean temporary repo and verifies:

- `kiwi init`
- `kiwi plan`
- `kiwi status`
- `kiwi evidence manifest`
- `kiwi operator snapshot`

## Packaging Notes

- CLI package: `@kiwi/cli`
- CLI binary: `kiwi`
- Build output: `apps/cli/dist`
- Runtime requirement: Node.js 20+
- Production packaging is blocked until safe apply/rollback and real provider/runner paths are fully validated.

## Release Blockers

- Add migration fixtures once schema evolution leaves `breaking_allowed`.
- Add real provider and runner fixture suites.
- Add sandbox security smoke for denied paths, approval paths, network-disabled behavior, timeout cleanup, and rollback.
- Step 22 (End-to-End Real Run Demo) must reach `DONE` before first tagged release.
