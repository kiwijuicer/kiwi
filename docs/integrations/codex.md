# Codex Integration

Official MCP docs: https://developers.openai.com/codex/mcp

## Config

Build `kiwi`:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/kiwi
pnpm build
```

Add to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.kiwi]
command = "node"
args = ["/Users/norberthanauer/Projects/kiwi-juicer/kiwi/apps/mcp-server/dist/index.js"]
env = { KIWI_WORKSPACE = "/Users/norberthanauer/Projects/voice" }
```

Codex CLI and the IDE extension share MCP configuration.

Check:

```bash
codex mcp list
```

Use:

```text
Use kiwi. Workspace: /Users/norberthanauer/Projects/voice. Repo: recorder.
Plan this ticket, run validation, finalize, and report the operator snapshot path.
```

## CLI Add Alternative

```bash
codex mcp add kiwi \
  --env KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  -- node /Users/norberthanauer/Projects/kiwi-juicer/kiwi/apps/mcp-server/dist/index.js
```
