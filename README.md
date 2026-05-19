<div align="center">

# 🥝 KiWi

**Local-first control plane for planned, safe, and auditable AI coding work.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#license)
[![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen)](#)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](#)

</div>

---

`kiwi` turns a ticket into a structured **TaskGraph**, lets an IDE assistant execute the planned steps through explicit safety gates, and stores reproducible evidence under `.kiwi/runs/<run-id>/`.

It is built for developers who want AI-assisted implementation **without losing control** over planning, approvals, diffs, gates, costs, and final review.

---

## 🎯 Why KiWi?

KiWi was built around two core goals:

### 💰 Cost-optimized execution

Naively letting a frontier model drive every step burns budget. KiWi keeps cost predictable by:

- **Per-step model routing** — each step in the TaskGraph declares what it needs (reasoning, code edit, lint fix, summarization) and KiWi picks the cheapest model that meets the bar.
- **Cost evidence per run** — every run records token usage and spend under `.kiwi/runs/<run-id>/`, so you can see exactly where the money went and tune your model policy.
- **Preview-before-spend gates** — expensive steps are previewed before execution; you approve the spend, not surprise it.

### 🧠 Sensible LLM choice per step

Not every step needs a flagship model. KiWi routes work to the **right tool for the job**:

| Step type | Typical model class | Why |
|---|---|---|
| Planning & TaskGraph synthesis | Strong reasoning model | Quality of the plan defines everything downstream |
| Code edits & refactors | Mid-tier coding model | Fast, accurate, far cheaper than top-tier |
| Lint fixes, renames, mechanical edits | Small local / cheap model | Deterministic-ish work, no reason to overpay |
| Summaries, commit messages, evidence notes | Small / fast model | Throughput matters more than depth |
| Critical review & gate decisions | Strong reasoning model | High-stakes — pay for accuracy here |

Configure the policy with `kiwi models list` / `kiwi models update --apply` — and switch providers without touching the rest of the pipeline.

---

## ✨ Highlights

- 💰 **Cost-optimized** — per-step model routing and full spend evidence per run
- 🧠 **Right model per step** — flagship for planning, cheap models for mechanical work
- 🥝 **Local-first by design** — no hosted control plane required
- 🧩 **Structured TaskGraph** planning from vague or concrete tickets
- 🛡️ **Safe step execution** through preview and approval boundaries
- 🔌 **MCP integration** for Cursor, Claude Code, Codex, and other compatible clients
- 📦 **Reproducible run artifacts** under `.kiwi/runs/<run-id>/`
- 📜 **Full audit trail** for decisions, attempts, diffs, gates, reviews, and cost evidence
- 🗂️ **Single-repo and multi-repo** workspace support
- ⚙️ **Provider-neutral** architecture with local CLI runner integrations

---

## 📦 Install

```bash
git clone git@github.com:kiwijuicer/kiwi.git
cd kiwi

make install
kiwi --version
```

This installs:

| Binary | Path |
|---|---|
| `kiwi` | `~/.local/bin/kiwi` |
| `kiwi-mcp-stdio` | `~/.local/bin/kiwi-mcp-stdio` |

> 💡 Make sure `~/.local/bin` is on your `PATH`.

Refresh an existing install without reinstalling dependencies:

```bash
make install INSTALL_DEPS=0
```

---

## ⚙️ Configuration

Initialize kiwi inside the workspace or repo you want it to control:

```bash
cd /path/to/workspace

kiwi init
kiwi doctor
```

`kiwi init` already writes a baseline model registry to `~/.kiwi/defaults/`. To pull the latest curated release catalog (newer models, updated pricing), run:

```bash
kiwi models update --apply
```

Recommended on first install, optional afterwards.

**Limit MCP config generation to one client:**

```bash
kiwi init --mcp cursor
kiwi init --mcp claude
kiwi init --mcp codex
```

**For multi-repo workspaces:**

```bash
kiwi init --workspace /path/to/workspace
kiwi workspace list --workspace /path/to/workspace
kiwi doctor --workspace /path/to/workspace --repo <repo-id>
```

**Manual MCP config:**

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

---

## 🚀 Usage

Use kiwi through your IDE assistant:

```text
Use kiwi for this ticket in repo <repo-id>; follow kiwi_next and ask before running.
```

With explicit safety gates:

```text
Use kiwi for this ticket in repo <repo-id>. Run kiwi_doctor, plan it, follow kiwi_next,
show me the preview confirmation summary before mutation, then finalize and report
the evidence manifest path.
```

### The normal MCP flow

```text
kiwi_doctor → kiwi_plan → kiwi_next → kiwi_preview_run
  → confirm preview
  → run recommended tool call
  → kiwi_next → kiwi_finalize → kiwi_evidence_manifest
```

### CLI fallback

```bash
kiwi plan ./ticket.md --workspace /path/to/workspace --repo <repo-id>
kiwi run <run-id> --workspace /path/to/workspace
kiwi finalize <run-id> --workspace /path/to/workspace
kiwi evidence manifest <run-id> --workspace /path/to/workspace
```

### Useful commands

| Command | Purpose |
|---|---|
| `kiwi init` | Initialize kiwi in the current workspace |
| `kiwi doctor` | Diagnose configuration and environment |
| `kiwi workspace list` | List configured workspaces / repos |
| `kiwi models list` | Show available model configurations |
| `kiwi models update --apply` | Refresh model definitions |
| `kiwi status [run-id]` | Show run status |
| `kiwi runs unlock <run-id> --approved-by <name>` | Unlock a stuck or held run |
| `kiwi operator snapshot <run-id>` | Capture operator-level snapshot |

---

## 🤝 Contribution

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm kiwi:src --help
```

Before proposing a change:

- Keep the change **scoped**
- Preserve **typed package boundaries**
- Update **docs and contracts** when behavior changes
- Run **checks relevant** to the touched scope

---

## 👤 Author

**KiWi** is written and maintained by [Norbert Hanauer](mailto:norbert.hanauer@check24.de).

## 📄 License

KiWi is available under the [MIT License](#).
