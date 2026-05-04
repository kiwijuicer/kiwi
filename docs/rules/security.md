# Security Rules

## Default Security Posture

- No direct writes to main branch.
- No git staging, commits, tags, or pushes unless explicitly requested by the user.
- No migration execution without explicit approval.
- No dependency installation without explicit approval.
- No unrestricted shell by default.
- No raw secret material in prompts or logs.
- No SCM/API credentials in Core, run artifacts, prompts, or adapter inputs.

## Risk Zones

Treat these as high-risk by default:

- auth-related code
- payment-related code
- infra and deployment code
- migration paths
- workflow/CI files
- secret-bearing files

## Execution Controls

- Enforce command allowlists by step type.
- Enforce path deny/approval lists.
- Restrict environment variables to allowlist.
- Apply timeout and process limits.
- Keep per-attempt audit evidence.
- Keep external auth at the boundary: CLI login, OAuth connector, OS keychain, MCP server, or injected transport.
- Stop code work at an inspectable working-tree diff by default; draft commit messages only when asked.

## Review Controls

- High-risk changes require stronger review tier.
- High-risk changes may require human approval.
- Budget constraints must never weaken security constraints.
