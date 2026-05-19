export function defaultKiwiConfigYaml(nowIso: string): string {
  return `version: "1"
initializedAt: "${nowIso}"
`;
}

export const DEFAULT_POLICY_YAML = `version: "1"
project:
  name: kiwi
  language: typescript
  packageManager: pnpm

commands:
  test: pnpm test
  lint: pnpm lint
  typecheck: pnpm typecheck

routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  providerPreference:
    planner: [codex-cli, claude-code-cli]
    reviewer: [codex-cli, claude-code-cli]
    executor: [codex-cli, claude-code-cli, cursor-agent-cli]
    researcher: [codex-cli, claude-code-cli]
    security: [codex-cli, claude-code-cli]
    rules: [codex-cli, claude-code-cli]
  stepTypeOverrides:
    planning:
      agentRole: planner
      modelCapability: frontier
    review:
      agentRole: reviewer
      modelCapability: frontier
    validation:
      agentRole: reviewer
      modelCapability: strong
    coding:
      agentRole: executor
      modelCapability: strong
    code_creation:
      agentRole: executor
      modelCapability: strong
    code_modification:
      agentRole: executor
      modelCapability: strong
    refactoring:
      agentRole: executor
      modelCapability: strong
    scm_ticket:
      agentRole: executor
      modelCapability: mid
    scm_pull_request:
      agentRole: executor
      modelCapability: mid
    scm_review:
      agentRole: executor
      modelCapability: mid
    test_creation:
      agentRole: executor
      modelCapability: mid

riskZones:
  high:
    - src/auth/**
    - src/payment/**
    - infra/**
    - migrations/**
    - .github/workflows/**

approvals:
  requireFor:
    - migration
    - dependency_addition
    - production_config_change
  commandApprovalStates:
    read_only_command: auto
    migration: required
    dependency_addition: required
    production_config_change: required
    unrestricted_shell: blocked

execution:
  owner: kiwi-codex-cli
  isolation: direct
  sandbox: workspace-write
  forbidStaging: true
  forbidCommits: true
  forbidPushes: true

commandProfiles:
  default:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: [migrations/**]
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  validation:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  coding:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: [migrations/**]
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  code_creation:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: [migrations/**]
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  code_modification:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: [migrations/**]
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  refactoring:
    allowedCommands: [node, pnpm]
    approvalState: auto
    approvalRequiredPaths: [migrations/**]
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  scm_ticket:
    allowedCommands: []
    approvalState: required
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  scm_pull_request:
    allowedCommands: []
    approvalState: required
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
  scm_review:
    allowedCommands: []
    approvalState: required
    approvalRequiredPaths: []
    deniedPaths: [.env*, secrets/**]
    envAllowlist: [PATH, CI]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 120000
    maxOutputBytes: 65536
`;

export const DEFAULT_MODEL_REGISTRY_YAML = `version: "1"
catalogVersion: "2026-05-19"
# Model registry. Codex CLI entries intentionally omit providerModel by default;
# configure local overrides once your Codex CLI model names are known.
#
# Each entry declares an \`accessMode\`. Resolution priority at invocation:
#   1. \`KIWI_FORCE_ACCESS_MODE\` env override
#   2. codex-cli (uses local \`codex\` authentication)
#   3. claude-code-cli / cursor-agent-cli (uses local CLI auth)
#   4. cursor / jetbrains as IDE surfaces, plus local
#   5. stub (tests only via KIWI_TEST_ALLOW_STUB=1 and KIWI_FORCE_ACCESS_MODE=stub)
models:
  # Codex CLI — disabled/unconfigured until a workspace override supplies real local model names.
    - id: codex-cli-cheap
      provider: local
      capability: cheap
      roles: [researcher, executor, reviewer, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: manual
        sourceUrl: https://github.com/openai/codex
        sourceVersion: codex-cli-local
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: codex-cli
      enabled: false
    - id: codex-cli-mid
      provider: local
      capability: mid
      roles: [researcher, executor, reviewer, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: manual
        sourceUrl: https://github.com/openai/codex
        sourceVersion: codex-cli-local
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: codex-cli
      enabled: true
    - id: codex-cli-strong
      provider: local
      capability: strong
      roles: [planner, researcher, executor, reviewer, security, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: manual
        sourceUrl: https://github.com/openai/codex
        sourceVersion: codex-cli-local
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: codex-cli
      enabled: true
    - id: codex-cli-frontier
      provider: local
      capability: frontier
      roles: [planner, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: manual
        sourceUrl: https://github.com/openai/codex
        sourceVersion: codex-cli-local
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: codex-cli
      enabled: true

  # Claude Code CLI — fallback, reuses local claude auth.
    - id: claude-code-cli-frontier
      providerModel: claude-opus-4-7
      provider: anthropic
      capability: frontier
      roles: [planner, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 5
        outputUsdPerMillion: 25
        source: anthropic
        sourceUrl: https://platform.claude.com/docs/en/about-claude/pricing
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: claude-code-cli
      enabled: true
    - id: claude-code-cli-strong
      providerModel: claude-sonnet-4-6
      provider: anthropic
      capability: strong
      roles: [executor, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 3
        outputUsdPerMillion: 15
        source: anthropic
        sourceUrl: https://platform.claude.com/docs/en/about-claude/pricing
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: claude-code-cli
      enabled: true
    - id: claude-code-cli-mid
      providerModel: claude-haiku-4-5-20251001
      provider: anthropic
      capability: mid
      roles: [researcher, executor, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 1
        outputUsdPerMillion: 5
        source: anthropic
        sourceUrl: https://platform.claude.com/docs/en/about-claude/pricing
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: claude-code-cli
      enabled: true

  # Cursor Agent CLI — uses local cursor-agent login, no direct provider API key
    - id: cursor-agent-auto
      providerModel: auto
      provider: local
      capability: strong
      roles: [planner, researcher, executor, reviewer]
      pricing:
        currency: USD
        inputUsdPerMillion: 3
        outputUsdPerMillion: 15
        source: manual
        sourceUrl: https://cursor.com/pricing
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: cursor-agent-cli
      enabled: true
    - id: cursor-agent-mid
      providerModel: auto
      provider: local
      capability: mid
      roles: [researcher, executor, reviewer]
      pricing:
        currency: USD
        inputUsdPerMillion: 1
        outputUsdPerMillion: 5
        source: manual
        sourceUrl: https://cursor.com/pricing
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: cursor-agent-cli
      enabled: true

  # Stub providers — test fixtures only.
    - id: stub-cheap
      provider: stub
      capability: cheap
      roles: [executor, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: test
        sourceUrl: https://github.com/kiwi-juicer/ai-kiwi
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: stub
      enabled: true
    - id: stub-mid
      provider: stub
      capability: mid
      roles: [researcher, executor, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: test
        sourceUrl: https://github.com/kiwi-juicer/ai-kiwi
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: stub
      enabled: true
    - id: stub-strong
      provider: stub
      capability: strong
      roles: [executor, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: test
        sourceUrl: https://github.com/kiwi-juicer/ai-kiwi
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: stub
      enabled: true
    - id: stub-frontier
      provider: stub
      capability: frontier
      roles: [planner, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
        source: test
        sourceUrl: https://github.com/kiwi-juicer/ai-kiwi
        sourceVersion: "2026-05-19"
        pricingLastVerifiedAt: "2026-05-19T00:00:00.000Z"
      accessMode: stub
      enabled: true
`;
