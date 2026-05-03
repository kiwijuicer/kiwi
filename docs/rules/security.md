# Security Rules

## Default Security Posture

- No direct writes to main branch.
- No migration execution without explicit approval.
- No dependency installation without explicit approval.
- No unrestricted shell by default.
- No raw secret material in prompts or logs.

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

## Review Controls

- High-risk changes require stronger review tier.
- High-risk changes may require human approval.
- Budget constraints must never weaken security constraints.
