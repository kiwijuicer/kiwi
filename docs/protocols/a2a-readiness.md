# A2A Readiness

Status: preparation only

`ai-kiwi` does not implement an A2A runtime yet. The current boundary is a stable serialization layer for future protocol work.

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

## Readiness Criteria

A future A2A runtime may be planned only after:

- CLI run/attempt/finalize flows are stable
- MCP has parity for read/status/finalize operations
- protocol fixtures validate against contracts
- schema evolution policy moves beyond `breaking_allowed`
