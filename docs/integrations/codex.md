# Codex Integration

Official MCP docs: https://developers.openai.com/codex/mcp

## Config

Build `ai-kiwi`:

```bash
cd /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi
pnpm build
```

Add to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.ai-kiwi]
command = "node"
args = ["/Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js"]
env = { AI_KIWI_WORKSPACE = "/Users/norberthanauer/Projects/voice" }
```

Codex CLI and the IDE extension share MCP configuration.

Check:

```bash
codex mcp list
```

Use:

```text
Use ai-kiwi. Workspace: /Users/norberthanauer/Projects/voice. Repo: recorder.
Plan this ticket, run validation, finalize, and report the operator snapshot path.
```

## CLI Add Alternative

```bash
codex mcp add ai-kiwi \
  --env AI_KIWI_WORKSPACE=/Users/norberthanauer/Projects/voice \
  -- node /Users/norberthanauer/Projects/kiwi-juicer/ai-kiwi/apps/mcp-server/dist/index.js
```
