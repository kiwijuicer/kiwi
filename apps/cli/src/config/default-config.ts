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
# Model registry. Capability tiers map to real Codex CLI models below.
#
# Each entry declares an \`accessMode\`. Resolution priority at invocation:
#   1. \`KIWI_FORCE_ACCESS_MODE\` env override
#   2. codex-cli (uses local \`codex\` authentication)
#   3. claude-code-cli / cursor-agent-cli (uses local CLI auth)
#   4. cursor / jetbrains as IDE surfaces, plus local
#   5. stub (tests only)
models:
  # Codex CLI — preferred default, uses local codex auth and explicit model switching.
    - id: codex-cli-cheap
      providerModel: gpt-5.4-mini
      provider: local
      capability: cheap
      roles: [researcher, executor, reviewer, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0.4
        outputUsdPerMillion: 1.6
      accessMode: codex-cli
      enabled: true
    - id: codex-cli-mid
      providerModel: gpt-5.4-mini
      provider: local
      capability: mid
      roles: [researcher, executor, reviewer, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0.4
        outputUsdPerMillion: 1.6
      accessMode: codex-cli
      enabled: true
    - id: codex-cli-strong
      providerModel: gpt-5.4
      provider: local
      capability: strong
      roles: [planner, researcher, executor, reviewer, security, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 2
        outputUsdPerMillion: 8
      accessMode: codex-cli
      enabled: true
    - id: codex-cli-frontier
      providerModel: gpt-5.5
      provider: local
      capability: frontier
      roles: [planner, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 10
        outputUsdPerMillion: 40
      accessMode: codex-cli
      enabled: true

  # Claude Code CLI — fallback, reuses local claude auth.
  # \`id\` is Kiwi-local. Omit \`providerModel\` by default so the Claude CLI
  # resolves its current configured/default model dynamically.
    - id: claude-code-cli-frontier
      provider: anthropic
      capability: frontier
      roles: [planner, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 5
        outputUsdPerMillion: 25
      accessMode: claude-code-cli
      enabled: true
    - id: claude-code-cli-strong
      provider: anthropic
      capability: strong
      roles: [executor, reviewer, security]
      pricing:
        currency: USD
        inputUsdPerMillion: 3
        outputUsdPerMillion: 15
      accessMode: claude-code-cli
      enabled: true
    - id: claude-code-cli-mid
      provider: anthropic
      capability: mid
      roles: [researcher, executor, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 1
        outputUsdPerMillion: 5
      accessMode: claude-code-cli
      enabled: true

  # Cursor Agent CLI — uses local cursor-agent login, no direct provider API key
    - id: cursor-agent-auto
      provider: local
      capability: strong
      roles: [planner, researcher, executor, reviewer]
      pricing:
        currency: USD
        inputUsdPerMillion: 3
        outputUsdPerMillion: 15
      accessMode: cursor-agent-cli
      enabled: true
    - id: cursor-agent-mid
      provider: local
      capability: mid
      roles: [researcher, executor, reviewer]
      pricing:
        currency: USD
        inputUsdPerMillion: 1
        outputUsdPerMillion: 5
      accessMode: cursor-agent-cli
      enabled: true

  # Stub providers — tests/dev fixtures only. CLI/MCP planning and execution
  # ignore these unless explicitly enabled with --allow-stub, KIWI_ALLOW_STUB=1,
  # or KIWI_FORCE_ACCESS_MODE=stub.
    - id: stub-cheap
      provider: stub
      capability: cheap
      roles: [executor, rules]
      pricing:
        currency: USD
        inputUsdPerMillion: 0
        outputUsdPerMillion: 0
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
      accessMode: stub
      enabled: true
`;
