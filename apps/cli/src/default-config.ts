export function defaultKiwiConfigYaml(nowIso: string): string {
  return `version: "1"
initializedAt: "${nowIso}"
`;
}

export const DEFAULT_POLICY_YAML = `version: "1"
project:
  name: ai-kiwi
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
`;

export const DEFAULT_MODEL_REGISTRY_YAML = `version: "1"
models:
  - id: stub-cheap
    provider: stub
    capability: cheap
    roles: [executor, rules]
    enabled: true
  - id: stub-mid
    provider: stub
    capability: mid
    roles: [researcher, executor, rules]
    enabled: true
  - id: stub-strong
    provider: stub
    capability: strong
    roles: [executor, reviewer, security]
    enabled: true
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer, security]
    enabled: true
`;
