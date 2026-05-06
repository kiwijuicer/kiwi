# Step 39: Researcher Provider

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: Step 38
Vision-Refs: 5.1, 9

## Goal

Make the `Researcher` agent role useful. Today it is defined in
`packages/contracts/src/common.ts` and routed via
`step-type: context_discovery` but no provider exists.

## Scope

- New module
  `packages/runtime/src/researcher-provider-registry.ts` mirroring the
  planner registry. The registry resolves a `mid`/`cheap` model with
  the `researcher` role and the best-available access mode.
- New adapter
  `packages/adapters/src/researcher-provider.ts` defining the
  `ResearcherProvider` interface (input: `Initiative`, candidate
  files; output: structured `ResearchReport` JSON with relevant
  files, symbols of interest, open questions).
- Implementations: `AnthropicResearcherProvider`,
  `ClaudeCodeCliResearcherProvider`. Reuse `repo-context` from step
  38 to feed the researcher.
- Wire into the run loop so `context_discovery` steps run via the
  researcher provider instead of the executor runner; the result is
  persisted under `plan/research-report.json` and fed back into the
  planner via `planner-input.json`.

## Out Of Scope

- New step types beyond the existing `context_discovery`.
- Web search or external KB integration.

## Tasks

- Add the contracts: `ResearchReportSchema` in
  `packages/contracts/src/execution.ts`.
- Build the registry, adapter base, and Anthropic + CLI variants.
- Update the CLI/MCP run loops.
- Tests covering the report shape and that the planner receives the
  research output.

## Acceptance Criteria

- A run with a `context_discovery` step writes
  `plan/research-report.json` and the planner-input includes a
  reference to that file.
- Researcher costs land in `final-cost-report.json` under the
  `executor` phase (or a new `researcher` phase if we choose to add
  one - decision noted in plan body).

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
