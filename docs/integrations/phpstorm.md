# PhpStorm AI Assistant Integration

Official MCP docs: https://www.jetbrains.com/help/ai-assistant/mcp.html

## Local MCP Server

Build `kiwi`:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/kiwi
pnpm build
```

In PhpStorm, open AI Assistant MCP settings and add a local server with this JSON:

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

Restart the IDE if the MCP server is not picked up immediately.

Use:

```text
Use kiwi for workspace /Users/norberthanauer/Projects/voice and repo core.
Create a plan for this change and show me the current run status.
```

## PhpStorm as a Separate MCP Server

JetBrains IDEs can also expose their own MCP server for external clients. That is separate from `kiwi`: `kiwi` orchestrates runs and evidence; the JetBrains MCP server exposes IDE actions.
