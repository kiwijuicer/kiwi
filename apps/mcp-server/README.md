# kiwi MCP Server

Thin MCP access channel over `packages/core`.

The CLI remains the reference operator surface. MCP clients use the same run store, policy, locks, evidence, and audit artifacts.

## Start stdio

```bash
pnpm build
KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  node apps/mcp-server/dist/index.js
```

For single-repo use, set `KIWI_WORKSPACE` to the repo root or omit it when the client starts the server from the repo root.

## Start HTTP

```bash
pnpm build
KIWI_MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
node apps/mcp-server/dist/index.js \
  --transport http \
  --workspace /Users/norberthanauer/Projects/voice \
  --host 127.0.0.1 \
  --port 3333
```

Cursor config for local Streamable HTTP:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "http",
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

The HTTP transport refuses to start without `KIWI_MCP_HTTP_TOKEN`.
Every POST to `/mcp` must include `Authorization: Bearer <token>`.
CORS only limits browser origins; it is not authentication. The HTTP transport
binds to `127.0.0.1` by default and rejects non-local `Origin` headers unless
explicitly allowed with `KIWI_MCP_ALLOWED_ORIGINS`.

Codex-first execution uses the current repo working tree by default. Kiwi selects
the concrete Codex CLI `providerModel` per step and passes it with `--model`;
`KIWI_EXECUTION_ISOLATION=worktree` is the opt-in isolated mode.

## Tool API

Core tools:

- `kiwi_doctor`: diagnose workspace/repo/config/git/client readiness.
- `kiwi_plan`: create a planned run.
- `kiwi_status`: read run status.
- `kiwi_next`: read-only router that returns one exact `recommendedToolCall`, why it is safe now, expected mutation, and safe alternatives.
- `kiwi_preview_run`: return the execution decision card: step order, selected models/runners, cost, gates, execution mode, mutation scope, confirmation summary, and a fresh `previewToken`.
- `kiwi_run`: execute planned steps in order with a fresh `previewToken`.
- `kiwi_run_step`: execute one planned step with a fresh `previewToken`.
- `kiwi_diff`: read persisted attempt patch stats and diff.
- `kiwi_apply`: apply a persisted worktree patch. Unsafe apply overrides are not exposed over MCP.
- `kiwi_finalize`: write final verdict, summary, and cost report.
- `kiwi_evidence_manifest`: write hashed evidence manifest and audit snapshot.
- `kiwi_operator_snapshot`: write local operator HTML snapshot.
- `kiwi_publish_pr_draft`: push a Bitbucket branch using local git auth and write `final/pr-draft.json`.

Additional tools:

- `kiwi_request_approval`: record an approval decision.

Workspace-aware tools accept:

```json
{
  "workspacePath": "/Users/norberthanauer/Projects/voice",
  "repoId": "core",
  "repoPath": "/Users/norberthanauer/Projects/voice/voice-core"
}
```

Tool calls must pass an object in `params.arguments`. Stringified JSON arguments
and top-level argument fallbacks are rejected with `-32602`.

Use either `repoId` or `repoPath`. `repoId` maps to the names listed by `kiwi workspace list`; `repoPath` can be absolute or relative to the workspace.

## Minimal Flow

```json
{
  "name": "kiwi_doctor",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "repoId": "core"
  }
}
```

Then:

```json
{
  "name": "kiwi_plan",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "repoId": "core",
    "ticket": "# Fix consent sync\n\n## Validate"
  }
}
```

Then:

```json
{
  "name": "kiwi_preview_run",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "runId": "<run-id>"
  }
}
```

Read the preview `decision.confirmationSummary` to the user. If confirmed, call the returned `decision.nextAction.recommendedToolCall`:

```json
{
  "name": "kiwi_run",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "runId": "<run-id>",
    "previewToken": "<preview-token>"
  }
}
```

Finalize and inspect:

```json
{
  "name": "kiwi_finalize",
  "arguments": {
    "workspacePath": "/Users/norberthanauer/Projects/voice",
    "runId": "<run-id>"
  }
}
```

## Resources

Resources expose the run store for the server workspace:

- `kiwi://runs`

Resource templates are exposed through `resources/templates/list`:

- `kiwi://runs/{runId}`
- `kiwi://runs/{runId}/manifest`
- `kiwi://runs/{runId}/initiative`
- `kiwi://runs/{runId}/task-graph`
- `kiwi://runs/{runId}/planner-input`
- `kiwi://runs/{runId}/planner-output`
- `kiwi://runs/{runId}/planner-cost`
- `kiwi://runs/{runId}/attempts`
- `kiwi://runs/{runId}/final-summary`
- `kiwi://runs/{runId}/final-verdict`
- `kiwi://runs/{runId}/audit`
- `kiwi://runs/{runId}/evidence-manifest`
- `kiwi://runs/{runId}/operator-snapshot`
- `kiwi://runs/{runId}/artifacts/{artifactRef}`

`artifactRef` is the percent-encoded run artifact path, for example `plan%2Ftask-graph.json`.

For multi-repo work, start one server per workspace or set `KIWI_WORKSPACE` per client config.

## Safety

- A run lock protects mutating operations.
- Every tool definition includes MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) for client risk prompts.
- `kiwi_next` is the default read-only router after every run-related tool, error, interruption, or uncertain state.
- MCP `kiwi_run` and `kiwi_run_step` require a fresh `previewToken` from `kiwi_preview_run`.
- Preview tokens bind to run id, TaskGraph hash, policy hash, registry hash, repo branch, repo HEAD, dirty state, `fromStep`, and `maxConcurrency`. Kiwi-owned `.kiwi/` artifacts are ignored in the dirty-state fingerprint.
- Direct execution is blocked on `main`/`master`, tracked dirty files, untracked non-Kiwi files, or non-git repos. Use worktree isolation for those states.
- Action-required errors return `data.recovery.recommendedToolCall` instead of relying on the model to infer recovery.
- `approved` is not accepted as an MCP run shortcut; use `kiwi_request_approval`.
- `forceUnsafe` is not accepted over MCP.
- `kiwi_request_approval` only records approval for the latest blocked attempt of a step and only for the approval-required files recorded in gate evidence.
- Tool descriptions carry risk labels: `READ_ONLY`, `WRITES_RUN_ARTIFACTS`, `MUTATES_WORKTREE`, `APPLIES_PATCH`, `PUSHES_BRANCH`.
- Direct Anthropic/OpenAI API keys are not required for daily use; local CLI auth is used for Claude, Codex, and Cursor Agent.
- Direct execution captures a pre-step git tree snapshot and persists only the step diff as run evidence.
- Bitbucket PR draft publishing uses local git auth only, requires a clean tree including untracked files, stages only expected diff files, and does not store Bitbucket credentials.
- Step worktrees copy only the selected repo when `KIWI_EXECUTION_ISOLATION=worktree` is enabled.
