# Step 15: Scope Freeze and Model Tier Collapse

Status: DONE
Done-Date: 2026-05-04
Created-Date: 2026-05-04
Milestone: Production Milestone 1 (Real Loop)
Depends-On: Step 14
Vision-Refs: 5.2, 5.3, 13, 14.3, 17.5

## Goal

Establish a hard scope freeze for the Real Loop milestone and collapse the four-tier model capability ladder to the three real Anthropic tiers in active use.

## Scope

- Freeze A2A runtime as-is. No new A2A features land in Production Milestone 1. `packages/core/src/a2a-runtime*.ts` and related CLI/MCP surfaces stay stable.
- Update `.kiwi/model-registry.yaml` with real Anthropic model entries:
  - `frontier` -> `claude-opus-4-6`
  - `strong` -> `claude-sonnet-4-6`
  - `mid` -> `claude-haiku-4-5-20251001`
  - `cheap` -> alias of `mid` with reduced context budget; not a separate model.
- Keep stub providers as test fixtures only. Default selection in `.kiwi/policy.yaml` switches from stub to real once Steps 16-18 are `DONE`.
- Document tier-to-step-type defaults so the scheduler does not silently re-route:
  - `planning` -> `frontier`
  - `review` -> `frontier` for `riskZones.high`, `strong` otherwise
  - `coding` -> `strong`
  - `validation`, `test_creation`, `documentation`, `rules_update` -> `mid`
- Add a `frozen` marker to the A2A plan and protocol docs so future contributors do not extend it.

## Out Of Scope

- Removing A2A code or tests.
- Implementing real provider classes (Step 16+).
- Changing `MODEL_CAPABILITY_VALUES` in `packages/contracts`. The four-name enum stays; only the registry mapping collapses.
- Operator UI or dashboard surfaces.

## Tasks

- Edit `.kiwi/model-registry.yaml`. Keep existing stub models behind `enabled: false` for tests that opt in explicitly.
- Document tier defaults in `docs/architecture.md` (extend, do not replace).
- Add `Status: FROZEN` headers to `docs/plans/step-14-*.md` and `docs/protocols/a2a-readiness.md` notes that point at this milestone.
- Update `.kiwi/policy.yaml` defaults to reference real capability names, not provider IDs.
- Add a one-paragraph "scope freeze" section to `docs/plans/README.md` that lists what is frozen and until when.

## Acceptance Criteria

- `.kiwi/model-registry.yaml` lists `claude-opus-4-6`, `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`.
- `cheap` resolves to the same provider as `mid` and is documented as a context-budget variant.
- A2A surfaces are marked as frozen and no Step 16-22 task touches them.
- `pnpm typecheck` and `pnpm test` stay green.
- When complete, set `Status: DONE` and `Done-Date: YYYY-MM-DD`.

## Validation

- `pnpm typecheck`
- `pnpm test`
- `pnpm lint:arch`
