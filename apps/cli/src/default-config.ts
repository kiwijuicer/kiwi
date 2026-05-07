export function defaultKiwiConfigYaml(nowIso: string): string {
  return `version: "1"
initializedAt: "${nowIso}"
a2a:
  enabled: false
  localAgentId: kiwi-local
  acceptedKinds: [initiative, task_graph, step_attempt, gate_result, review_verdict, artifact]
  peers: []
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
# Model registry. Capability tiers map to real models below.
# \`cheap\` is documented as an alias of \`mid\` (Haiku) with a smaller context
# budget; it is not a separate model entry.
#
# Each entry declares an \`accessMode\`. Resolution priority at invocation:
#   1. \`KIWI_FORCE_ACCESS_MODE\` env override
#   2. claude-code-cli (uses local \`claude\` authentication)
#   3. codex-cli / cursor-agent-cli (uses local CLI auth)
#   4. cursor / jetbrains as IDE surfaces, plus local
#   5. stub (tests only)
models:
  # Claude Code CLI — preferred default, reuses local claude auth.
  # \`id\` is Kiwi-local. Omit \`providerModel\` by default so the Claude CLI
  # resolves its current configured/default model dynamically.
  - id: claude-code-cli-frontier
    provider: anthropic
    capability: frontier
    roles: [planner, reviewer, security]
    accessMode: claude-code-cli
    enabled: true
  - id: claude-code-cli-strong
    provider: anthropic
    capability: strong
    roles: [executor, reviewer, security]
    accessMode: claude-code-cli
    enabled: true
  - id: claude-code-cli-mid
    provider: anthropic
    capability: mid
    roles: [researcher, executor, rules]
    accessMode: claude-code-cli
    enabled: true

  # Cursor Agent CLI — uses local cursor-agent login, no direct provider API key
  - id: cursor-agent-auto
    provider: local
    capability: strong
    roles: [executor]
    accessMode: cursor-agent-cli
    enabled: true

  # Codex CLI — uses local codex auth, no direct OpenAI API key
  - id: codex-cli-auto
    provider: local
    capability: strong
    roles: [executor]
    accessMode: codex-cli
    enabled: true

  # Stub providers — tests/dev fixtures only
  - id: stub-cheap
    provider: stub
    capability: cheap
    roles: [executor, rules]
    accessMode: stub
    enabled: true
  - id: stub-mid
    provider: stub
    capability: mid
    roles: [researcher, executor, rules]
    accessMode: stub
    enabled: true
  - id: stub-strong
    provider: stub
    capability: strong
    roles: [executor, reviewer, security]
    accessMode: stub
    enabled: true
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer, security]
    accessMode: stub
    enabled: true
`;
