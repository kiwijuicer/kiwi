# Claude Integration

Official MCP docs: https://code.claude.com/docs/en/mcp

## Claude Code

Build `kiwi` first:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/kiwi
pnpm build
```

Add the local stdio MCP server from the target workspace:

```bash
cd /Users/norberthanauer/Projects/voice
claude mcp add --transport stdio \
  --env KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  kiwi \
  -- node /Users/norberthanauer/Projects/kiwi-juicer/kiwi/apps/mcp-server/dist/index.js
```

Check it:

```bash
claude mcp list
```

Inside Claude, use:

```text
Use kiwi for workspace /Users/norberthanauer/Projects/voice and repo core.
Plan this ticket, run it, finalize it, and show the evidence manifest path.
```

## Project Config Alternative

If you keep a project-scoped `.mcp.json`, use:

```json
{
  "mcpServers": {
    "kiwi": {
      "command": "node",
      "args": ["/Users/norberthanauer/Projects/kiwi-juicer/kiwi/apps/mcp-server/dist/index.js"],
      "env": {
        "KIWI_WORKSPACE": "/Users/norberthanauer/Projects/voice"
      }
    }
  }
}
```

Claude may ask for approval before using a project-scoped MCP server. That is expected.
