# Cursor Integration

Official MCP docs: https://docs.cursor.com/advanced/model-context-protocol

## Project Config

From the Cursor project terminal:

```bash
kiwi init
```

This writes or merges `.cursor/mcp.json` with a `kiwi` MCP server entry and preserves other configured servers.
Plain `kiwi init` also prepares Claude Code and Codex MCP config by default; use `kiwi init --mcp cursor` when you only want Cursor.

Manual setup is still possible after `make install`.

Create `/path/to/workspace/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "stdio",
      "command": "kiwi-mcp",
      "args": ["--workspace", "/path/to/workspace"]
    }
  }
}
```

Restart Cursor, then ask:

```text
Use kiwi for workspace /path/to/workspace and repo worker-service.
Run kiwi_doctor, plan this change, call kiwi_next, preview it, and show the TaskGraph summary plus decision.confirmationSummary.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_next -> kiwi_preview_run -> user confirm decision.confirmationSummary -> decision.nextAction.recommendedToolCall -> kiwi_next -> finalize/evidence/snapshot
```

## Global Config

For all projects, use `~/.cursor/mcp.json` with the same `mcpServers` block. For workspace-specific work, prefer the project config so the server name and workspace stay obvious.

## Expected Tools

Cursor should expose:

- `kiwi_doctor`
- `kiwi_plan`
- `kiwi_status`
- `kiwi_preview_run`
- `kiwi_next`
- `kiwi_run`
- `kiwi_run_step`
- `kiwi_diff`
- `kiwi_cost`
- `kiwi_explain`
- `kiwi_finalize`
- `kiwi_evidence_manifest`
- `kiwi_operator_snapshot`
- `kiwi_publish_pr_draft`

Cursor Agent execution uses the local `cursor-agent` login. No Anthropic/OpenAI API key is required by Kiwi.
