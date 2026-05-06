# Step 25: Drop Empty Placeholder Folders

Status: COMPLETED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 6.1

## Goal

Remove empty `packages/core/src/{policy,registry,schemas,storage,graph}`
folders. They are inherited from earlier scaffolding and confuse readers
and tooling.

## Scope

- Delete folders with no `*.ts` content.
- If `packages/core/src/storage/` is needed later for step 24's
  `json-io.ts`, leave it - the file makes it non-empty.
- Confirm `tsc --noEmit` and `pnpm lint:arch` are unaffected.

## Out Of Scope

- Renaming or restructuring the populated folders.

## Tasks

- `git rm` the empty directories one by one.
- Re-run typecheck and arch lint.

## Acceptance Criteria

- No empty `*.ts`-less folders left under `packages/core/src/`.
- All gates green.

## Validation

- `find packages -type d -empty` returns nothing under `src`.
