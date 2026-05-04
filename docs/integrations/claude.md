# Claude Integration

Official MCP docs: https://code.claude.com/docs/en/mcp

## Claude Code

Build `ai-kiwi` first:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi
pnpm build
```

Add the local stdio MCP server from the target workspace:

```bash
cd /Users/norberthanauer/Projects/voice
claude mcp add --transport stdio \
  --env AI_KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  ai-kiwi \
  -- node /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js
```

Check it:

```bash
claude mcp list
```

Inside Claude, use:

```text
Use ai-kiwi for workspace /Users/norberthanauer/Projects/voice and repo core.
Plan this ticket, run it, finalize it, and show the evidence manifest path.
```

## Project Config Alternative

If you keep a project-scoped `.mcp.json`, use:

```json
{
  "mcpServers": {
    "ai-kiwi": {
      "command": "node",
      "args": ["/Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js"],
      "env": {
        "AI_KIWI_WORKSPACE": "/Users/norberthanauer/Projects/voice"
      }
    }
  }
}
```

Claude may ask for approval before using a project-scoped MCP server. That is expected.
