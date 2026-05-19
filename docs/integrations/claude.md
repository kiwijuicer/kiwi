# Claude Integration

Official MCP docs: https://code.claude.com/docs/en/mcp

## Claude Code

From the Claude Code project terminal:

```bash
kiwi init
```

This writes or merges project-scoped `.mcp.json` with a `kiwi` MCP server entry and preserves other configured servers.
Plain `kiwi init` also prepares Cursor and Codex MCP config by default; use `kiwi init --mcp claude` when you only want Claude Code.

Manual setup is still possible after `make install`.

Add the local stdio MCP server from the target workspace:

```bash
cd /path/to/workspace
claude mcp add --transport stdio \
  kiwi \
  -- kiwi-mcp --workspace /path/to/workspace
```

Check it:

```bash
claude mcp list
```

Inside Claude, use:

```text
Use kiwi for workspace /path/to/workspace and repo api-service.
Run kiwi_doctor, plan this ticket, call kiwi_next, show the preview decision summary, ask me to confirm, run the returned recommendedToolCall, finalize it, and show the evidence manifest path.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_next -> kiwi_preview_run -> user confirm decision.confirmationSummary -> decision.nextAction.recommendedToolCall -> kiwi_next -> finalize/evidence/snapshot
```

## Project Config Alternative

If you keep a project-scoped `.mcp.json`, use:

```json
{
  "mcpServers": {
    "kiwi": {
      "command": "kiwi-mcp",
      "args": ["--workspace", "/path/to/workspace"]
    }
  }
}
```

Claude may ask for approval before using a project-scoped MCP server. That is expected.

Claude execution uses the local `claude` CLI login. Kiwi does not require `ANTHROPIC_API_KEY` for the standard flow.
