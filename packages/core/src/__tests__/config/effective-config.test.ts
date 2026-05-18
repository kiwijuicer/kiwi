import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  kiwiHomeModelRegistryPath,
  kiwiHomePolicyPath,
  kiwiModelRegistryPath,
  kiwiPolicyPath,
  loadEffectivePolicy,
  loadEffectiveRegistry,
  resolveKiwiHome,
} from "../../config";

const POLICY_YAML = `version: "1"
project:
  name: shared
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
    planner: [codex-cli]
    executor: [codex-cli]
  stepTypeOverrides: {}
riskZones:
  high: [src/auth/**]
approvals:
  requireFor: [migration]
  commandApprovalStates: {}
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
`;

const REGISTRY_YAML = `version: "1"
models:
  - id: codex-cli-frontier
    providerModel: gpt-5.5
    provider: local
    capability: frontier
    roles: [planner, reviewer]
    accessMode: codex-cli
    enabled: true
  - id: codex-cli-mid
    providerModel: gpt-5.4-mini
    provider: local
    capability: mid
    roles: [executor]
    accessMode: codex-cli
    enabled: true
`;

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "kiwi-effective-config-"));
}

function write(target: string, contents: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf-8");
}

describe("effective kiwi config", () => {
  it("resolves KIWI_HOME when configured", () => {
    const home = path.join(tmp(), "home");

    expect(resolveKiwiHome({ KIWI_HOME: home })).toBe(home);
  });

  it("loads home defaults when workspace overrides are absent", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomePolicyPath(env), POLICY_YAML);
    write(kiwiHomeModelRegistryPath(env), REGISTRY_YAML);

    expect(loadEffectivePolicy(workspace, { env }).project.name).toBe("shared");
    expect(loadEffectiveRegistry(workspace, { env }).models.map((model) => model.id)).toEqual([
      "codex-cli-frontier",
      "codex-cli-mid",
    ]);
  });

  it("deep merges workspace policy overrides over home defaults", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomePolicyPath(env), POLICY_YAML);
    write(
      kiwiPolicyPath(workspace),
      `commands:
  test: npm test
routing:
  providerPreference:
    planner: [claude-code-cli]
riskZones:
  high: [app/secure/**]
`,
    );

    const policy = loadEffectivePolicy(workspace, { env });

    expect(policy.project.name).toBe("shared");
    expect(policy.commands.test).toBe("npm test");
    expect(policy.commands.lint).toBe("pnpm lint");
    expect(policy.routing.providerPreference.planner).toEqual(["claude-code-cli"]);
    expect(policy.routing.providerPreference.executor).toEqual(["codex-cli"]);
    expect(policy.riskZones.high).toEqual(["app/secure/**"]);
  });

  it("merges registry models by id and allows disabling inherited entries", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomeModelRegistryPath(env), REGISTRY_YAML);
    write(
      kiwiModelRegistryPath(workspace),
      `models:
  - id: codex-cli-frontier
    enabled: false
  - id: custom-mid
    provider: stub
    capability: mid
    roles: [executor]
    enabled: true
`,
    );

    const registry = loadEffectiveRegistry(workspace, { env });
    const frontier = registry.models.find((model) => model.id === "codex-cli-frontier");

    expect(frontier).toMatchObject({ providerModel: "gpt-5.5", enabled: false });
    expect(registry.models.map((model) => model.id)).toEqual(["codex-cli-frontier", "codex-cli-mid", "custom-mid"]);
  });

  it("requires home defaults even when workspace override files exist", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiPolicyPath(workspace), POLICY_YAML);
    write(kiwiModelRegistryPath(workspace), REGISTRY_YAML);

    expect(() => loadEffectivePolicy(workspace, { env })).toThrow(kiwiHomePolicyPath(env));
    expect(() => loadEffectiveRegistry(workspace, { env })).toThrow(kiwiHomeModelRegistryPath(env));
  });

  it("requires valid home defaults before applying workspace overrides", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomePolicyPath(env), 'version: "1"\nproject: {}\n');
    write(kiwiHomeModelRegistryPath(env), 'version: "1"\nmodels:\n  - enabled: true\n');
    write(kiwiPolicyPath(workspace), POLICY_YAML);
    write(kiwiModelRegistryPath(workspace), REGISTRY_YAML);

    expect(() => loadEffectivePolicy(workspace, { env })).toThrow();
    expect(() => loadEffectiveRegistry(workspace, { env })).toThrow();
  });

  it("rejects registry override entries without ids", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomeModelRegistryPath(env), REGISTRY_YAML);
    write(kiwiModelRegistryPath(workspace), "models:\n  - enabled: false\n");

    expect(() => loadEffectiveRegistry(workspace, { env })).toThrow("non-empty id");
  });

  it("rejects registry override models that are not arrays", () => {
    const home = path.join(tmp(), "home");
    const workspace = path.join(tmp(), "workspace");
    const env = { KIWI_HOME: home };
    mkdirSync(workspace);
    write(kiwiHomeModelRegistryPath(env), REGISTRY_YAML);
    write(kiwiModelRegistryPath(workspace), "models: disabled\n");

    expect(() => loadEffectiveRegistry(workspace, { env })).toThrow("models must be an array");
  });
});
