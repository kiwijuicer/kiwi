# Cursor Integration

Official MCP docs: https://docs.cursor.com/advanced/model-context-protocol

## Project Config

Build `ai-kiwi`:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi
pnpm build
```

Create `/Users/norberthanauer/Projects/voice/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ai-kiwi": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js"],
      "env": {
        "AI_KIWI_WORKSPACE": "/Users/norberthanauer/Projects/voice"
      }
    }
  }
}
```

Restart Cursor, then ask:

```text
Use ai-kiwi for workspace /Users/norberthanauer/Projects/voice and repo livekit-agent.
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
