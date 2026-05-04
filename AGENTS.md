# AGENTS.md

This file is the canonical entrypoint for coding agents working on `kiwi`.

Follow these rule documents first:

- `docs/rules/project.md`
- `docs/rules/architecture.md`
- `docs/rules/typescript.md`
- `docs/rules/testing.md`
- `docs/rules/security.md`
- `docs/rules/agents.md`

## Required Workflow

1. Read `docs/vision.md` and all rule files before substantial work.
2. Keep changes small and scoped to one concern when possible.
3. Prefer explicit contracts and typed boundaries over implicit coupling.
4. Run required checks for touched scope before proposing merge.
5. Never bypass safety or approval constraints for risky paths.

## Core Product Intent

`kiwi` is a local-first AI coding control plane.

Primary outcome:

- reliable TaskGraph planning
- safe step execution
- structured review and gate evidence
- reproducible run artifacts under `.kiwi/runs/<run-id>/`

## Rule Priority

When rules conflict, apply this order:

1. `docs/rules/security.md`
2. `docs/rules/architecture.md`
3. `docs/rules/typescript.md`
4. `docs/rules/testing.md`
5. `docs/rules/project.md`
6. `docs/rules/agents.md`
