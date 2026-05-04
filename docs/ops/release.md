# Release Checklist

Status: draft

## Release Gate

Run before tagging or packaging:

```bash
pnpm release:check
```

This currently runs:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke`

`pnpm lint` is still a placeholder and must be replaced before production release.

## Smoke Coverage

`pnpm smoke` creates a clean temporary repo and verifies:

- `kiwi init`
- `kiwi plan`
- `kiwi status`
- `kiwi evidence manifest`
- `kiwi operator snapshot`
- gated A2A loopback receive with an explicit trusted sender
- trusted filesystem A2A publish/sync/import and ReviewVerdict reply correlation between two local peers

## Packaging Notes

- CLI package: `@kiwi/cli`
- CLI binary: `kiwi`
- Build output: `apps/cli/dist`
- Runtime requirement: Node.js 20+
- Production packaging is blocked until real linting, safe apply/rollback, and real provider/runner paths exist.

## Release Blockers

- Configure real linting.
- Add migration fixtures once schema evolution leaves `breaking_allowed`.
- Add real provider and runner fixture suites.
- Add sandbox security smoke for denied paths, approval paths, network-disabled behavior, timeout cleanup, and rollback.
