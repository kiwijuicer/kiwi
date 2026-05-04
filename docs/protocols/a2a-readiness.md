# A2A Readiness

Status: gated loopback only

`ai-kiwi` now has a disabled-by-default local loopback runtime for validating and recording A2A envelopes.
It is not a remote execution runtime and does not apply remote patches.

## Stable Envelope

Future A2A-facing messages must use `ProtocolEnvelopeSchema` from `packages/contracts`:

- `schemaVersion`: current contracts schema version
- `protocol`: `a2a-prep`
- `kind`: `initiative | task_graph | step_attempt | gate_result | review_verdict | artifact`
- `payload`: one canonical domain object
- `createdAt`: ISO timestamp

## Externalization Candidates

- Initiative intake handoff
- TaskGraph publication
- StepAttempt status and artifacts
- GateResult evidence
- ReviewVerdict decisions

## Explicitly Out Of Scope

- remote agent discovery
- remote auth or trust negotiation
- cross-process agent runtime
- automatic patch application from external agents
- multi-tenant service behavior

## Runtime Gate

The runtime only accepts envelopes when:

- loopback mode is explicitly enabled
- `a2a` metadata is present
- `recipientAgentId` matches the local agent
- `senderAgentId` is explicitly trusted
- the envelope kind is allowed by policy
- the idempotency key has not already been handled
- payload validates against the canonical schema for its kind

Patch and diff artifacts are blocked until local apply gates exist.

## Readiness Criteria

A future A2A runtime may be planned only after:

- CLI run/attempt/finalize flows are stable
- MCP has parity for read/status/finalize operations
- protocol fixtures validate against contracts
- schema evolution policy moves beyond `breaking_allowed`
