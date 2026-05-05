# Cursor Integration

Official MCP docs: https://docs.cursor.com/advanced/model-context-protocol

## Project Config

From the Cursor project terminal:

```bash
kiwi init
```

This writes or merges `.cursor/mcp.json` with a `kiwi` MCP server entry and preserves other configured servers.

Manual setup is still possible. Build `kiwi`:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi
pnpm build
```

Create `/Users/norberthanauer/Projects/voice/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js"],
      "env": {
        "KIWI_WORKSPACE": "/Users/norberthanauer/Projects/voice"
      }
    }
  }
}
```

Restart Cursor, then ask:

```text
Use kiwi for workspace /Users/norberthanauer/Projects/voice and repo livekit-agent.
Plan this change and show the TaskGraph summary.
```

## Global Config

For all projects, use `~/.cursor/mcp.json` with the same `mcpServers` block. For project-specific Voice work, prefer the project config so the server name and workspace stay obvious.

## Expected Tools

Cursor should expose:

- `kiwi_plan`
- `kiwi_status`
- `kiwi_run`
- `kiwi_run_step`
- `kiwi_finalize`
- `kiwi_evidence_manifest`
- `kiwi_operator_snapshot`
- `kiwi_publish_pr_draft`

Cursor Agent execution uses the local `cursor-agent` login. No Anthropic/OpenAI API key is required by Kiwi.
