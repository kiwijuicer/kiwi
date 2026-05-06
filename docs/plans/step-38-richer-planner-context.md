# Step 38: Richer Planner Context

Status: PLANNED
Created-Date: 2026-05-06
Milestone: Hardening
Depends-On: -
Vision-Refs: 5, 10

## Goal

Improve plan quality by feeding the planner more than a depth-2
directory listing.

## Scope

- New helper `packages/adapters/src/repo-context.ts` building a
  bounded context envelope:
  - top-level `README.md` head (first ~100 lines, with size cap),
  - `AGENTS.md` head,
  - top 25 result paths from a token-aware grep over the ticket's
    keywords (use `git grep` with the keyword list extracted from the
    ticket title + body),
  - the file path list (depth 3 instead of depth 2; cap 400 entries),
  - last 5 commits' subject lines,
  - paths of the latest local diff (`git diff --name-only HEAD`).
- Replace `repoSkeleton(repoPath)` in
  `packages/adapters/src/anthropic-planner-provider.ts` and the
  Claude Code CLI planner with calls to this helper. Both planner
  providers should pass identical context.
- Cap the resulting envelope at ~12k characters; if larger, drop in
  this order: file list -> grep snippets -> README/AGENTS heads.
- Persist the chosen context fields into
  `plan/planner-input.json` so users can audit what the planner saw.

## Out Of Scope

- Real symbol search (LSP/oxc). Plain `git grep` is enough for the
  first improvement.
- Embedding-based ranking.

## Tasks

- Implement `repo-context.ts` with deterministic ordering and caps.
- Wire into both planner providers.
- Update `planner-input.json` schema if needed.
- Test: snapshot the assembled context for a fixture repo.

## Acceptance Criteria

- Planner request body now includes README/AGENTS heads, grep hits
  and recent commits.
- `planner-input.json` reflects the same data.
- Total prompt size stays below the 12k character cap.

## Validation

- `pnpm typecheck && pnpm lint:eslint && pnpm lint:baseline`.
- Local `pnpm test`.
