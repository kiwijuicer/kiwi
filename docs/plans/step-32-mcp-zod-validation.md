# Step 32: MCP Server Zod Input Validation

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 14.2

## Goal

Validate every MCP tool input via a Zod schema instead of trusting the
JSON-Schema string in `tool-definitions.ts`. Bad inputs return a
structured JSON-RPC error with the offending field.

## Scope

- Define `ToolInputSchemas` map in
  `apps/mcp-server/src/tool-input-schemas.ts` with one Zod schema per
  tool (`kiwi_plan`, `kiwi_status`, `kiwi_run`, `kiwi_run_step`,
  `kiwi_finalize`, `kiwi_cost`, `kiwi_explain`,
  `kiwi_request_approval`, `kiwi_evidence_manifest`,
  `kiwi_operator_snapshot`, `kiwi_publish_pr_draft`).
- For A2A tools, reuse the schemas from `@kiwi/contracts` /
  `packages/a2a/src/types.ts` if present; otherwise add minimal
  schemas inline.
- In `apps/mcp-server/src/tools.ts`, wrap each call to parse inputs
  via the matching schema. On `ZodError`, return a JSON-RPC error
  `{ code: -32602, message: "Invalid params", data: { issues: [...] } }`.
- Optional improvement: derive the `inputSchema` JSON object in
  `tool-definitions.ts` from the Zod schema using
  `zod-to-json-schema` if it is already a dependency, otherwise keep
  the hand-written ones in sync.

## Out Of Scope

- Changing the MCP transport (stdio/http) layer.
- A2A new flows.

## Tasks

- Add `tool-input-schemas.ts`.
- Refactor `tools.ts` to validate before dispatch.
- Add JSON-RPC error path test in `apps/mcp-server/src/__tests__`.

## Acceptance Criteria

- A malformed `kiwi_plan` payload (missing `ticket` and `rawInput`)
  returns a JSON-RPC error with the offending fields.
- A valid payload still works.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test` for the MCP server tests.
