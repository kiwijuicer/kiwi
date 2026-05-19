# Codex Integration

Official MCP docs: https://developers.openai.com/codex/mcp

## Config

From the Codex project terminal:

```bash
kiwi init
```

This writes or merges project-scoped `.codex/config.toml` with a `kiwi` MCP server table and preserves other tables.
Plain `kiwi init` also prepares Cursor and Claude Code MCP config by default; use `kiwi init --mcp codex` when you only want Codex.

Manual setup is still possible after `make install`.

Add to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.kiwi]
command = "kiwi-mcp-stdio"
args = ["--workspace", "/path/to/workspace"]
```

Codex CLI and the IDE extension share MCP configuration.

Check:

```bash
codex mcp list
```

Use:

```text
Use kiwi. Workspace: /path/to/workspace. Repo: worker.
Run kiwi_doctor, plan this ticket, call kiwi_next, show the preview decision summary, ask me to confirm, run the returned recommendedToolCall, finalize, and report the operator snapshot path.
```

Safe MCP flow:

```text
kiwi_doctor -> kiwi_plan -> kiwi_next -> kiwi_preview_run -> user confirm decision.confirmationSummary -> decision.nextAction.recommendedToolCall -> kiwi_next -> finalize/evidence/snapshot
```

## CLI Add Alternative

```bash
codex mcp add kiwi \
  -- kiwi-mcp-stdio --workspace /path/to/workspace
```

Codex execution uses the local `codex` CLI login through `codex exec`. Kiwi does not require `OPENAI_API_KEY` for the standard flow.
