# PhpStorm AI Assistant Integration

Official MCP docs: https://www.jetbrains.com/help/ai-assistant/mcp.html

## Local MCP Server

Build `kiwi`:

```bash
cd /path/to/ai-kiwi
pnpm build
```

In PhpStorm, open AI Assistant MCP settings and add a local server with this JSON:

```json
{
  "mcpServers": {
    "kiwi": {
      "command": "node",
      "args": ["/path/to/ai-kiwi/apps/mcp-server/dist/index.js"],
      "env": {
        "KIWI_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

Restart the IDE if the MCP server is not picked up immediately.

Use:

```text
Use kiwi for workspace /path/to/workspace and repo api-service.
Create a plan for this change and show me the current run status.
```

## PhpStorm as a Separate MCP Server

JetBrains IDEs can also expose their own MCP server for external clients. That is separate from `kiwi`: `kiwi` orchestrates runs and evidence; the JetBrains MCP server exposes IDE actions.

JetBrains is a Kiwi MCP surface in this plan, not a Kiwi runner. Model execution still goes through local CLI providers such as `claude`, `codex`, or `cursor-agent`.
