# A2A Readiness

Status: trusted filesystem beta
Frozen-During: Production Milestone 1 (Real Loop)

> Scope freeze: A2A surfaces (`packages/core/src/a2a-runtime*.ts`,
> `apps/cli/src/commands/a2a.ts`, A2A MCP tools) are frozen for the
> duration of Production Milestone 1. No new A2A features land until
> Step 22 is `DONE`. Freeze enforced by `scripts/check-a2a-freeze.mjs`.
> See `docs/plans/production-milestone-1-real-loop.md`.

`kiwi` now has a disabled-by-default A2A runtime for validating, recording, and exchanging canonical envelopes between explicitly trusted local peers.
The beta transport is filesystem outbox/inbox. It is not remote discovery, auth negotiation, SaaS behavior, or automatic patch application.

## Stable Envelope

Future A2A-facing messages must use `ProtocolEnvelopeSchema` from `packages/contracts`:

- `schemaVersion`: current contracts schema version
- `protocol`: `a2a-prep`
- `kind`: `initiative | task_graph | step_attempt | gate_result | review_verdict | artifact`
- `payload`: one canonical domain object
- `createdAt`: ISO timestamp
- `a2a.attachments[]`: optional descriptors with `ref`, `sha256`, `bytes`, and `mediaType`

## Externalization Candidates

- Initiative intake handoff
- TaskGraph publication
- StepAttempt status and artifacts
- GateResult evidence
- ReviewVerdict decisions

## Explicitly Out Of Scope

- remote agent discovery
- remote auth or trust negotiation
- automatic patch application from external agents
- multi-tenant service behavior

## Runtime Gate

The runtime only accepts envelopes when:

- A2A is explicitly enabled in `.kiwi/config.yaml` or loopback mode is passed for diagnostics
- `a2a` metadata is present
- `recipientAgentId` matches the local agent
- `senderAgentId` is explicitly trusted
- the envelope kind is allowed by policy
- the idempotency key has not already been handled
- payload validates against the canonical schema for its kind
- attachment hashes and sizes match, when attachments are present

Patch and diff artifacts are quarantined by default until local apply gates exist.

## Filesystem Beta

Each workspace stores A2A state under `.kiwi/a2a/`:

- `transport/incoming`: peer delivery target
- `outbox/<peer>`: queued outbound envelopes
- `inbox`: accepted non-patch envelopes
- `quarantine`: corrupt envelopes and remote patch/diff artifacts
- `idempotency` and `ledger`: replay and correlation evidence

## Readiness Criteria

Moving beyond trusted filesystem beta requires:

- CLI and MCP parity for trust, publish, sync, inbox, and accept
- protocol fixtures and smoke tests validate peer exchange
- local gate/review promotion exists for quarantined patch artifacts
- schema evolution policy moves beyond `breaking_allowed`
