# Agent Working Rules

## Before Coding

- Read `AGENTS.md`, `docs/vision.md`, and all files in `docs/rules/`.
- Confirm the target milestone scope (especially MVP boundaries).
- Prefer one focused change set per task.

## During Coding

- Respect module boundaries and canonical domain terms.
- Keep changes small, reviewable, and reversible.
- Update docs/contracts when behavior or terminology changes.
- Preserve auditability of execution decisions and outputs.
- Do not stage, commit, tag, or push unless the user explicitly asks for that git operation.

## Validation Expectations

- Run tests relevant to touched scope.
- Run typecheck for touched packages.
- Run lint once linting is configured.

## Communication Expectations

- Report critical risk or ambiguity early.
- Do not hide trade-offs.
- Suggest safer alternatives when requested change conflicts with rules.
