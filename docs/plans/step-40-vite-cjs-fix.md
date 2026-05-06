# Step 40: Vite CJS Deprecation Fix

Status: PLANNED (DECISION REQUIRED)
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: -

## Source of the Warning

Vitest `1.6.1` (locked across all workspace packages) brings Vite
`5.x` as a transitive dependency. Vite 5 deprecated its CJS Node
API. Each `vitest.config.ts` and `tsup.config.ts` is loaded as
CommonJS because no package has `"type": "module"` and the files use
`.ts` extension, so the warning fires on every run.

## Options

1. **Smallest tweak (likely sufficient)**:
   rename every `vitest.config.ts` and `tsup.config.ts` to
   `vitest.config.mts` / `tsup.config.mts`. Both Vitest and tsup load
   `.mts` configs through ESM and the warning disappears. No
   dependency bumps.
2. **Vitest 2.x upgrade**: bump `vitest` to `^2.1.x`. Compatible with
   Node 20 (already required) and with Vite 5/6. Drop-in for our
   `defineConfig` usage. Eliminates the deprecation as a side effect
   because Vitest 2 uses the Vite ESM API.
3. **Vitest 3.x upgrade**: latest. Requires Node 20+ (we already
   pin >=20 in `package.json:engines`). Same drop-in surface but
   stricter on a few config keys.

## Recommendation

Start with option 1 (rename to `.mts`); if the warning persists or
config loading breaks, escalate to option 2. Skip option 3 for now;
it carries minor breakages around mocked imports we do not need to
absorb yet.

## Decision Gate

Before executing this step, surface the recommendation to the user
and wait for an explicit go for option 1 or 2. The previous waves are
independent of Vite tooling, so this can be the very last action.

## Out Of Scope

- Replacing Vitest with another runner.
- Dropping tsup in favor of esbuild scripts.

## Tasks (after approval)

- For option 1: `git mv` each config file, update any internal
  `__dirname` usage (`vitest.config.ts` already uses `path.resolve`,
  `import.meta.url` may be needed for `.mts`).
- For option 2: bump versions in every `package.json`, regenerate
  `pnpm-lock.yaml`, run `pnpm typecheck`, `pnpm test` locally.
- Verify the warning is gone in `pnpm test` output on the developer
  machine.

## Acceptance Criteria

- `pnpm test` no longer prints "The CJS build of Vite's Node API is
  deprecated".
- All test suites stay green.

## Validation

- Local `pnpm test` (sandbox cannot run vitest because of missing
  `@rollup/rollup-linux-arm64-gnu`).
