# TypeScript Rules

## Baseline

- Use strict TypeScript settings.
- Prefer explicit types at package boundaries.
- Keep runtime validation with Zod for all external inputs.

## Code Style

- Favor cohesive classes or objects over clusters of loose top-level functions when behavior belongs together.
- Use classes when they encapsulate state, dependencies, or a stable domain workflow; do not create method-bag classes that only hide loose functions.
- Prefer constructor injection for collaborating services and adapters.
- Replace repeated parameter clusters with explicit context/session objects when the values travel together through a workflow.
- Compatibility wrapper functions are allowed at public boundaries, but new internal call sites should use the service or factory instance directly.
- Exported loose workflow functions must stay as compatibility wrappers only; cohesive behavior belongs behind service/factory instances.
- Classes must not call exported wrapper functions when a service, repository, or adapter dependency exists for that behavior.
- Keep small pure helper functions when they are isolated, stateless, and not forming an implicit object.
- Keep one clear responsibility per module.
- Avoid duplicated branching logic; centralize shared decisions.
- Use descriptive names over short abbreviations.
- Do not use TypeScript `enum` for domain contracts; use `as const` values + union types + Zod schemas.
- Keep canonical domain string values in `@kiwi/contracts`; avoid hardcoded literals in runtime modules.
- Add missing serializable domain values as contract value arrays and value objects before using them in runtime code.
- Package-local status/mode/category values must use package-local `as const` value objects and derived types, not string-literal unions.
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
