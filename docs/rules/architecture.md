# Architecture Rules

## Module Boundaries

- `packages/contracts`: schemas, domain types, canonical value sets, shared interfaces.
- `packages/core`: planning primitives, config/workspace resolution, run state, audit/model ledgers.
- `packages/runtime`: execution orchestration, scheduler policy, quality gates, review engine, finalization.
- `packages/adapters`: provider and runner integrations behind contracts.
- SCM integrations (Bitbucket/GitHub/etc.) live in `packages/adapters` behind provider-neutral contracts.
- `packages/sandbox`: worktree lifecycle, process execution, permissions.
- `packages/ops`: operator/reporting surfaces, evidence manifests, run summaries, PR draft publishing.
- `apps/cli`: primary user interface.
- `apps/mcp-server`: integration channel, not orchestration source.

## Dependency Direction

- Apps may depend on packages.
- `core` may depend on `contracts`.
- `runtime` may depend on `core`, `contracts`, `adapters`, and `sandbox`.
- `adapters` may depend on `contracts` and `sandbox`.
- `sandbox` may depend on `contracts`.
- `ops` may depend on `core`, `runtime`, `adapters`, and `contracts`.
- `core` must not import provider-specific SDKs directly.
- `core` must not import SCM-provider SDKs or own SCM credentials directly.
- `core` must not import `runtime`, `ops`, `adapters`, or `sandbox`.

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
- Treat apps as composition roots for app-specific services.
- Packages should export service/factory entrypoints for cohesive workflows, with wrapper functions only for compatibility.
- Internal orchestration must depend on services/repositories/adapters, not exported wrapper functions from sibling modules.
- `packages/contracts` is the source of truth for serialized domain values; runtime packages should consume contract constants instead of repeating string literals.
- Package-local serialized values must be centralized in package constants when they do not belong in `packages/contracts`.
