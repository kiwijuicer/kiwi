# Architecture Rules

## Module Boundaries

- `packages/contracts`: schemas, domain types, enums, shared interfaces.
- `packages/core`: orchestration logic, scheduler, planning flow, run state.
- `packages/adapters`: provider and runner integrations behind contracts.
- `packages/sandbox`: worktree lifecycle, process execution, permissions.
- `apps/cli`: primary user interface.
- `apps/mcp-server`: integration channel, not orchestration source.

## Dependency Direction

- Apps may depend on packages.
- `core` may depend on `contracts`.
- `adapters` may depend on `contracts`.
- `sandbox` may depend on `contracts`.
- `core` must not import provider-specific SDKs directly.

## Canonical Domain Terms

Use only canonical terms from `docs/vision.md`:

- Initiative
- Run
- TaskGraph
- Step
- StepAttempt
- Artifact
- GateResult
- ReviewVerdict

## Architecture Guardrails

- Separate `agentRole` from `modelCapability`.
- Keep run persistence under `.kiwi/runs/<run-id>/`.
- Keep orchestration state explicit and serializable.
- Prefer additive evolution of schemas over breaking churn.
