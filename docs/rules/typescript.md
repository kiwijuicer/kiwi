# TypeScript Rules

## Baseline

- Use strict TypeScript settings.
- Prefer explicit types at package boundaries.
- Keep runtime validation with Zod for all external inputs.

## Code Style

- Favor cohesive classes or objects over clusters of loose top-level functions when behavior belongs together.
- Keep small pure helper functions when they are isolated, stateless, and not forming an implicit object.
- Keep one clear responsibility per module.
- Avoid duplicated branching logic; centralize shared decisions.
- Use descriptive names over short abbreviations.
- Do not use TypeScript `enum` for domain contracts; use `as const` values + union types + Zod schemas.
- Keep canonical domain string values in `@kiwi/contracts`; avoid hardcoded literals in runtime modules.
- Source file soft target: <= 600 lines. Functions soft target: <= 120 lines.
- Source files over 1000 lines require explicit refactor before adding more responsibilities.

## Error Handling

- Do not swallow errors.
- Include actionable context in thrown errors.
- Prefer typed/domain errors for expected failure modes.

## Data Contracts

- Parse untrusted data at boundaries.
- Keep schema and inferred type side by side in `contracts`.
- Avoid `any`; if unavoidable, isolate and document why.

## Maintainability

- Keep files focused and reasonably small.
- Extract helpers only when they remove duplication or improve clarity.
- Optimize for readability before micro-optimizations.
