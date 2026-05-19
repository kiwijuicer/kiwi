# kiwi

Local-first control plane for AI-assisted coding work.

`kiwi` turns a ticket into a TaskGraph, lets your IDE assistant execute the planned steps through MCP safety gates, and keeps reproducible evidence under `.kiwi/runs/<run-id>/`.

---

## For developers (using kiwi)

### 1. Checkout & install

```bash
# SSH
git clone git@github.com:kiwijuicer/kiwi.git
# or HTTPS
git clone https://github.com/kiwijuicer/kiwi.git

cd kiwi
make install
kiwi --version
```

This installs versioned release wrappers:

- `~/.local/bin/kiwi`
- `~/.local/bin/kiwi-mcp-stdio`

Make sure `~/.local/bin` is on your `PATH`.

Refresh the release only (deps already installed):

```bash
make install INSTALL_DEPS=0
```

### 2. Initialize a workspace, repo, or monorepo

In the project, repo, or workspace you want kiwi to control:

```bash
cd /path/to/workspace
kiwi init
kiwi models update --apply
kiwi doctor
```

What `kiwi init` does:

- writes shared defaults to `~/.kiwi/defaults/`
- creates workspace state under `<workspace>/.kiwi/`
- generates MCP config for Cursor, Claude Code, and Codex
- adds local kiwi/MCP paths to git ignore rules

Limit the MCP target if you only use one client:

```bash
kiwi init --mcp cursor   # or: claude | codex | all | none
```

Reload the IDE/MCP client after init so it picks up the new config.

**Multi-repo workspace:**

```bash
kiwi init --workspace /path/to/workspace
kiwi workspace list --workspace /path/to/workspace
kiwi doctor --workspace /path/to/workspace --repo <repo-id>
```

`repoId` maps to the ids shown by `kiwi workspace list`.

### 3. Use kiwi from your IDE (Cursor, Claude Code, Codex)

Once the workspace is initialized, drop this into chat:

```text
Use kiwi for this ticket in repo <repo-id>; follow kiwi_next and ask before running.
```

Longer prompt with explicit safety gates:

```text
Use kiwi for this ticket in repo <repo-id>. Run kiwi_doctor, plan it, follow kiwi_next,
show me the preview confirmation summary before mutation, then finalize and report
the evidence manifest path.
```

The assistant follows this MCP flow:

```text
kiwi_doctor → kiwi_plan → kiwi_next → kiwi_preview_run
  → show decision.confirmationSummary
  → wait for developer confirmation
  → run decision.nextAction.recommendedToolCall
  → kiwi_next → kiwi_finalize → kiwi_evidence_manifest
```

Why MCP is the default path: the assistant always knows the next safe call, mutations require a fresh `previewToken` from `kiwi_preview_run`, and every run produces artifacts and an audit trail under `.kiwi/runs/<run-id>/`.

### 4. Simple CLI usage (fallback / scripting)

MCP is the recommended interface. Use the CLI directly when scripting or running without an IDE assistant:

```bash
kiwi plan ./ticket.md --workspace /path/to/workspace --repo <repo-id>
kiwi run <run-id>     --workspace /path/to/workspace
kiwi finalize <run-id> --workspace /path/to/workspace
kiwi evidence manifest <run-id> --workspace /path/to/workspace
```

Full CLI surface:

```bash
kiwi init        [--workspace <path>] [--mcp <target>]
kiwi workspace list   [--workspace <path>]
kiwi doctor      [--workspace <path>] [--repo <id|path>]
kiwi models list|update [--apply]
kiwi config set approver <identity>
kiwi plan        <ticket|ticket-file>
kiwi status      [run-id]
kiwi run         <run-id>
kiwi finalize    <run-id>
kiwi evidence manifest <run-id>
kiwi runs unlock <run-id> --approved-by <name>
kiwi operator snapshot <run-id>
```

### Maintenance

```bash
make install                  # install / update
make install INSTALL_DEPS=0   # refresh release only
make rollback                 # revert to previous release
make uninstall
```

Optional runner installers:

```bash
make install-cursor-agent
make install-claude-code
```

Override the shared kiwi home:

```bash
export KIWI_HOME=/custom/path
```

`kiwi` never creates `~/.kiwi/config.yaml`, so the home directory is never treated as an initialized workspace.

### Manual MCP config

`kiwi init --mcp <target>` is preferred. For clients that need manual config, point them at the installed stdio server:

```json
{
  "mcpServers": {
    "kiwi": {
      "type": "stdio",
      "command": "kiwi-mcp-stdio",
      "args": ["--workspace", "/path/to/workspace"]
    }
  }
}
```

For multi-repo work, run one kiwi MCP server per workspace and pass the target repo in the MCP tool args or IDE prompt.

### Recovery

`kiwi doctor` reports stale run locks:

```text
stale run locks: 1
  run_20260519_120000: run.lock
```

Release after confirming no owner process is active:

```bash
kiwi runs unlock run_20260519_120000 --workspace /path/to/workspace --approved-by <name>
```

Use `--force` only when the lock owner is still alive and override is verified safe.

---

## For contributors (developing kiwi itself)

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm kiwi:src --help
```

Conventions:

- User-facing docs use `kiwi`, not `pnpm kiwi`.
- Shared policy/model defaults live in `~/.kiwi/defaults/`. Optional overlays can live in `<workspace>/.kiwi/policy.yaml` and `<workspace>/.kiwi/model-registry.yaml`.
- Real model execution uses local CLI logins (`claude`, `codex`, `cursor-agent`). Bitbucket publishing uses local git auth — kiwi never stores Bitbucket tokens.

---

## Further reading

- [User guide](docs/user-guide.md)
- [Architecture](docs/architecture.md)
- [Claude integration](docs/integrations/claude.md)
- [Cursor integration](docs/integrations/cursor.md)
- [Codex integration](docs/integrations/codex.md)
- [PhpStorm AI Assistant integration](docs/integrations/phpstorm.md)
- [MCP server reference](apps/mcp-server/README.md)
