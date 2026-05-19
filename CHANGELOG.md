# Changelog

## 1.0.0 - 2026-05-19

- Added curated model catalog refresh via `kiwi models update`, `kiwi models list`, and MCP `kiwi_models_update`.
- Made Codex CLI defaults explicit: no fictional model names; `codex-cli-cheap` is disabled until a real cheap tier is configured.
- Added run lock stale recovery, `kiwi runs unlock <run-id>`, doctor stale-lock warnings, and lock audit events.
- Added workspace approver identity config with `kiwi config set approver <identity>`.
- Split large MCP run tools, setup init code, scheduler policy context packaging, and budget-blocked attempt persistence.
- Updated Anthropic planner default to `claude-opus-4-7`.
- Documented model refresh, lock recovery, and 1.0 MCP/CLI flows.

### Release Validation

- Target command: `pnpm release:check`
- Manual clean-install smoke target: `make install`, `kiwi doctor`, `kiwi plan`, `KIWI_ALLOW_STUB=1 kiwi run`, `kiwi finalize`, `kiwi evidence manifest`
- MCP smoke target: `kiwi_doctor -> kiwi_plan -> kiwi_preview_run -> kiwi_run -> kiwi_finalize`
