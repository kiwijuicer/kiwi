# TypeScript Rules

## Baseline

- Use strict TypeScript settings.
- Prefer explicit types at package boundaries.
- Keep runtime validation with Zod for all external inputs.

## Code Style

- Favor small pure functions over large classes.
- Keep one clear responsibility per module.
- Avoid duplicated branching logic; centralize shared decisions.
- Use descriptive names over short abbreviations.

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
