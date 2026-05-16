# Project Rules

## Product Goal

Build `kiwi` as a local-first control plane for AI-assisted coding work:

- turn unclear input into a structured TaskGraph
- orchestrate safe step execution
- enforce quality gates
- keep full audit and cost traceability

## Product Non-Goals

- no autonomous end-to-end coding without gates
- no dashboard requirement
- no multi-tenant backend

## Operating Principles

- Keep scope tight per milestone.
- Prefer deterministic behavior over magic.
- Keep architecture evolvable without over-engineering.
- Keep user-facing commands simple and explicit.

## Source Of Truth

- Vision and architecture: `docs/vision.md`
- Agent entrypoint: `AGENTS.md`
- Additional constraints: sibling files in `docs/rules/`
