# @kiwi/runtime

`@kiwi/runtime` is the composition layer between operator surfaces and the
lower-level packages.

It owns wiring decisions that need multiple subsystems at once:

- provider and access-mode resolution
- runner adapter selection
- worktree sandbox setup and teardown
- required gate execution
- review-engine construction from registry and policy

It must not own canonical domain contracts, run persistence, SCM credentials,
or provider-specific protocol details. Those stay in `@kiwi/contracts`,
`@kiwi/core`, and `@kiwi/adapters`.

CLI and MCP should call runtime entrypoints for executable flows instead of
duplicating orchestration logic.
