# kiwi

Local-first control plane for AI-assisted coding work.

`kiwi` turns a ticket into a TaskGraph, lets an IDE assistant execute the planned steps through MCP safety gates, and keeps reproducible evidence under `.kiwi/runs/<run-id>/`.

## Quickstart

Daily kiwi usage is meant to happen through your IDE assistant after kiwi has been installed and the workspace has been initialized.

### 1. Install or update kiwi

From the kiwi checkout:

```bash
make install
kiwi --version
```

This installs versioned local release wrappers:

- `~/.local/bin/kiwi`
- `~/.local/bin/kiwi-mcp`

Versioned releases live under `~/.kiwi/install` by default.

If dependencies are already installed and you only want to refresh the release:

```bash
make install INSTALL_DEPS=0
```

Ensure `~/.local/bin` is on `PATH`.

### 2. Initialize a workspace for MCP

In the project or workspace you want kiwi to control:

```bash
cd /path/to/workspace
kiwi init
kiwi doctor
```

By default, `kiwi init` creates shared defaults under `~/.kiwi/defaults/`, initializes workspace state under `<workspace>/.kiwi/`, and writes project MCP config for Cursor, Claude Code, and Codex.
Kiwi commands require the shared defaults; workspace policy and registry files are overlays, not replacements for initialization.
It also prints which MCP clients were detected and what to do next when something is missing.
It adds local kiwi and MCP config paths to git ignore/exclude rules so generated setup files do not block later runs.

To limit or skip MCP config, pass an explicit target:

```bash
kiwi init --mcp cursor
kiwi init --mcp claude
kiwi init --mcp codex
kiwi init --mcp all
```

Valid targets are `none`, `cursor`, `claude`, `codex`, and `all`.

Restart or reload the IDE MCP client after initialization so it picks up the generated config.

### 3. Use kiwi from IDE chat

Main prompt:

```text
Use kiwi for this ticket in repo <repo-id>. Run kiwi_doctor, plan it, follow kiwi_next, show me the preview confirmation summary before mutation, then finalize and report the evidence manifest path.
```

Short prompt once the workspace is initialized:

```text
Use kiwi for this ticket in repo <repo-id>; follow kiwi_next and ask before running.
```

The IDE assistant should use this MCP flow:

```text
kiwi_doctor
-> kiwi_plan
-> kiwi_next
-> kiwi_preview_run
-> show decision.confirmationSummary
-> ask the developer to confirm
-> run decision.nextAction.recommendedToolCall
-> kiwi_next
-> kiwi_finalize
-> kiwi_evidence_manifest
```

## Why MCP is the normal path

- The developer does not need to remember the full command sequence.
- `kiwi_next` tells the IDE assistant the next safe tool call.
- Mutating MCP tools require a fresh `previewToken` from `kiwi_preview_run`.
- The assistant must show `decision.confirmationSummary` before running mutations.
- Run artifacts, audit trails, costs, and evidence stay under `.kiwi/runs/<run-id>/`.
- Shared policy/model defaults come from `~/.kiwi/defaults/`; optional workspace overrides can live in `<workspace>/.kiwi/policy.yaml` and `<workspace>/.kiwi/model-registry.yaml`.

Daily use does not require direct Anthropic/OpenAI API keys. Real model execution uses local CLI logins such as `claude`, `codex`, or `cursor-agent`. Bitbucket publishing uses local git auth; kiwi does not store Bitbucket tokens.

## Multi-repo workspaces

For a workspace with multiple repos:

```bash
kiwi init --workspace /path/to/workspace
kiwi workspace list --workspace /path/to/workspace
kiwi doctor --workspace /path/to/workspace --repo <repo-id>
```

In IDE chat, include the target repo:

```text
Use kiwi for this ticket in repo <repo-id>; follow kiwi_next and ask before running.
```

`repoId` maps to the ids shown by `kiwi workspace list`. You can also pass a repo path where the tool or prompt supports repo selection.

## Manual MCP config

`kiwi init --mcp <target>` is preferred. For clients that need manual config, point them at the installed stdio server:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "stdio",
      "command": "/Users/<you>/.local/bin/kiwi-mcp",
      "args": ["--workspace", "/path/to/workspace"]
    }
  }
}
```

For multi-repo work, start one kiwi MCP server per workspace and pass the target repo in the MCP tool arguments or IDE prompt.

## Setup and maintenance

Common setup commands:

```bash
make install
make install INSTALL_DEPS=0
make rollback
make uninstall
kiwi init
kiwi init --mcp <target>
kiwi doctor
kiwi workspace list
```

Set `KIWI_HOME=/custom/path` to use a different shared kiwi home. Kiwi does not create `~/.kiwi/config.yaml`, so the home directory is never treated as an initialized workspace.

Optional local runner installers:

```bash
make install-cursor-agent
make install-claude-code
```

## CLI fallback / advanced use

MCP is the recommended daily interface. Use the CLI when setting up, debugging, scripting, or operating without an IDE assistant.

```bash
kiwi init [--workspace <path>] [--mcp <target>]
kiwi workspace list [--workspace <path>]
kiwi doctor [--workspace <path>] [--repo <id|path>]
kiwi plan <ticket|ticket-file> [--workspace <path>] [--repo <id|path>]
kiwi status [run-id] [--workspace <path>]
kiwi run <run-id> [--workspace <path>]
kiwi finalize <run-id> [--workspace <path>]
kiwi evidence manifest <run-id> [--workspace <path>]
kiwi operator snapshot <run-id> [--workspace <path>]
```

Example:

```bash
kiwi plan ./ticket.md --workspace /path/to/workspace --repo <repo-id>
kiwi run <run-id> --workspace /path/to/workspace
kiwi finalize <run-id> --workspace /path/to/workspace
kiwi evidence manifest <run-id> --workspace /path/to/workspace
```

## Developing kiwi itself

Contributor workflow:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm kiwi:src --help
```

Installed-user docs should use `kiwi`, not `pnpm kiwi`.

## More detail

- [User guide](docs/user-guide.md)
- [Claude integration](docs/integrations/claude.md)
- [Cursor integration](docs/integrations/cursor.md)
- [Codex integration](docs/integrations/codex.md)
- [PhpStorm AI Assistant integration](docs/integrations/phpstorm.md)
- [MCP server reference](apps/mcp-server/README.md)
