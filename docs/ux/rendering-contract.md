# Kiwi UX Rendering Contract

Kiwi MCP output is Markdown-first for humans in chat and IDEs.

## Goals

- Show concise status first, not a large JSON object.
- Link the generated plan as a local Markdown file.
- Make review diffs readable as Markdown sections with fenced diff blocks.
- Surface the selected model/provider for the planner and every scheduled step.
- Keep full structured artifacts under `.kiwi/runs/<run-id>/` for auditability.
- Return machine-readable MCP `structuredContent` separately from visible Markdown.

## Output Surfaces

| Surface | Default output |
|---|---|
| `kiwi_plan` | Markdown summary, planner model, clickable `plan.md` link, step/model table |
| `kiwi_preview_run` | Execution summary, cost, and per-step selected model/provider |
| `kiwi_diff` | Markdown sections per step with stats and fenced diff blocks |
| `kiwi_status` | Compact run state and step list |
| Step progress | Readable progress lines such as `[1/3] Routing step_001: claude-sonnet-4-6 via claude-code` |

## Plan Artifact

`kiwi_plan` writes:

```text
.kiwi/runs/<run-id>/plan.md
```

The MCP response links to this file with a `file://` URI so IDEs and terminals
can open it directly. The artifact contains:

- run ID and plan ID
- planner model and provider
- estimated cost
- summary
- step table with role, model, and cost
- acceptance criteria, assumptions, and open questions

## Model Labels

Human-facing output should prefer concrete provider model labels when available:

```text
<providerModel> via <provider or access mode>
```

Examples:

- `claude-sonnet-4-6 via claude-code-cli`
- `gpt-5.4 via codex-cli`
- `stub-model (stub-frontier) via stub`
