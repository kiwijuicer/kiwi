# Cursor Integration

Official MCP docs: https://docs.cursor.com/advanced/model-context-protocol

## Project Config

From the Cursor project terminal:

```bash
kiwi init --mcp cursor
```

This writes or merges `.cursor/mcp.json` with a `kiwi` MCP server entry and preserves other configured servers.

Manual setup is still possible after `make install`.

Create `/Users/norberthanauer/Projects/voice/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "stdio",
      "command": "/Users/norberthanauer/.local/bin/kiwi-mcp",
      "args": ["--workspace", "/Users/norberthanauer/Projects/voice"]
    }
  }
}
```

Restart Cursor, then ask:

```text
Use kiwi for workspace /Users/norberthanauer/Projects/voice and repo livekit-agent.
Run kiwi_doctor, plan this change, preview it, and show the TaskGraph summary plus previewToken.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_preview_run -> user confirm -> kiwi_run -> kiwi_diff -> kiwi_finalize -> kiwi_evidence_manifest/operator_snapshot
```

## Global Config

For all projects, use `~/.cursor/mcp.json` with the same `mcpServers` block. For project-specific Voice work, prefer the project config so the server name and workspace stay obvious.

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
