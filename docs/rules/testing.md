# Testing Rules

## Required Test Layers

- Contract tests for schemas and serialization.
- Core logic tests for planning, scheduling, run state transitions.
- CLI tests for command behavior and output contracts.

## Test Principles

- Test behavior, not implementation details.
- Keep tests deterministic and hermetic.
- Use fixtures for realistic ticket/policy/registry inputs.
- Prefer focused unit tests plus a small number of integration tests.
- Stub access modes are test-only and require `KIWI_TEST_ALLOW_STUB=1`.

## Gate Alignment

For behavior changes, ensure tests cover:

- existing behavior compatibility
- new behavior acceptance criteria
- risky path regression where applicable

## Minimalistic

- do only run related or changed tests or lintings
- do NOT just run all tests and liniting accross all files

## Minimum Commands

- `pnpm test`
- `pnpm typecheck`
- lint command once configured (`pnpm lint`)
