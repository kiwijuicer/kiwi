# ai-kiwi

Local-first control plane for AI-assisted coding work.

`ai-kiwi` turns a ticket into a TaskGraph, runs scoped steps through local policy gates, and keeps reproducible evidence under `.kiwi/runs/<run-id>/`.

## 5-minute Quickstart

From a fresh checkout, install the `kiwi` command globally with one command:

```bash
make install
```

This bootstraps `pnpm` through Corepack when needed, installs dependencies, builds the CLI, writes `kiwi` to `~/.local/bin`, and adds that directory to `~/.zshrc` when it is missing from `PATH`. The installed command rebuilds from this checkout before each run, so it follows the current local source.

If dependencies are already installed and you only want to refresh the bin wrapper:

```bash
make install INSTALL_DEPS=0
```

From this repository:

```bash
pnpm install
pnpm build
pnpm kiwi init
pnpm kiwi plan "# Fix the failing checkout test"
pnpm kiwi status
```

For a multi-repo workspace such as `/Users/norberthanauer/Projects/voice`:

```bash
pnpm build
pnpm kiwi init --workspace /Users/norberthanauer/Projects/voice
pnpm kiwi workspace list --workspace /Users/norberthanauer/Projects/voice
pnpm kiwi plan ./ticket.md --workspace /Users/norberthanauer/Projects/voice --repo core
pnpm kiwi run <run-id> --workspace /Users/norberthanauer/Projects/voice
pnpm kiwi finalize <run-id> --workspace /Users/norberthanauer/Projects/voice
pnpm kiwi evidence manifest <run-id> --workspace /Users/norberthanauer/Projects/voice
pnpm kiwi operator snapshot <run-id> --workspace /Users/norberthanauer/Projects/voice
```

The workspace root owns `.kiwi/runs`. The selected repo is copied into the per-attempt sandbox, so sibling repos are not pulled into a worktree.

## CLI Surface

Core commands:

```bash
kiwi init [--workspace <path>]
kiwi workspace list [--workspace <path>]
kiwi plan <ticket|ticket-file> [--workspace <path>] [--repo <id|path>]
kiwi status [run-id] [--workspace <path>]
kiwi run <run-id> [--workspace <path>]
kiwi attempt <run-id> <step-id> [--workspace <path>]
kiwi finalize <run-id> [--workspace <path>]
kiwi evidence manifest <run-id> [--workspace <path>]
kiwi operator snapshot <run-id> [--workspace <path>]
```

Without `--workspace`, `ai-kiwi` keeps the old single-repo behavior. In a known workspace, it detects repos from `*.code-workspace`; if more than one repo matches, pass `--repo`. The selector can be the listed id, such as `core`, or a folder path, such as `voice-core`.

## MCP / IDE Assistants

Build the MCP server:

```bash
pnpm build
```

Use this local stdio server in Claude, Cursor, Codex, or PhpStorm AI Assistant:

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

Ask the assistant to use `ai-kiwi` to plan, run, finalize, and inspect evidence. For workspace tasks, include the target repo, for example: `Plan this for repo core in workspace /Users/norberthanauer/Projects/voice`.

More detail:

- [User guide](docs/user-guide.md)
- [Claude integration](docs/integrations/claude.md)
- [Cursor integration](docs/integrations/cursor.md)
- [Codex integration](docs/integrations/codex.md)
- [PhpStorm AI Assistant integration](docs/integrations/phpstorm.md)
- [MCP server reference](apps/mcp-server/README.md)
