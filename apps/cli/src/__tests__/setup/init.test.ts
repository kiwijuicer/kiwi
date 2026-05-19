import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
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
  loadKiwiConfig,
} from "@kiwi/core";
import { runConfigSetApprover } from "../../commands/setup/config.js";
import { runInit } from "../../commands/setup/init.js";

interface CursorMcpConfig {
  mcpServers?: Record<
    string,
    {
      type?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

interface CodexConfig {
  content: string;
}

function readCursorMcpConfig(cwd: string): CursorMcpConfig {
  return JSON.parse(readFileSync(path.join(cwd, ".cursor", "mcp.json"), "utf-8")) as CursorMcpConfig;
}

function readClaudeCodeMcpConfig(cwd: string): CursorMcpConfig {
  return JSON.parse(readFileSync(path.join(cwd, ".mcp.json"), "utf-8")) as CursorMcpConfig;
}

function readCodexConfig(cwd: string): CodexConfig {
  return {
    content: readFileSync(path.join(cwd, ".codex", "config.toml"), "utf-8"),
  };
}

function testEnv(cwd: string, env: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...env,
    KIWI_HOME: env.KIWI_HOME ?? path.join(path.dirname(cwd), `${path.basename(cwd)}-home`),
  };
}

async function runInitForTest(opts: Parameters<typeof runInit>[0] = {}, cwd: string = process.cwd()): Promise<void> {
  await runInit({ ...opts, env: testEnv(cwd, opts.env) }, cwd);
}

function expectMcpLaunchForWorkspace(
  server: NonNullable<CursorMcpConfig["mcpServers"]>[string] | undefined,
  cwd: string,
): void {
  expect(server?.type).toBe("stdio");
  if (server?.command?.endsWith("kiwi-mcp-stdio")) {
    expect(server.args).toEqual(["--workspace", cwd]);
    expect(server.env).toBeUndefined();

    return;
  }
  expect(server?.args?.join(" ")).toContain("mcp-server");
  expect(server?.args).toContain("--workspace");
  expect(server?.args).toContain(cwd);
  expect(server?.env).toBeUndefined();
}

async function withKiwiMcpBin(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const previous = process.env.KIWI_MCP_BIN;

  if (value === undefined) {
    delete process.env.KIWI_MCP_BIN;
  } else {
    process.env.KIWI_MCP_BIN = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.KIWI_MCP_BIN;
    } else {
      process.env.KIWI_MCP_BIN = previous;
    }
  }
}

describe("kiwi init", () => {
  it("creates .kiwi, default config files, and all MCP configs by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-"));
    const env = testEnv(cwd);

    await runInitForTest({}, cwd);

    expect(existsSync(path.join(cwd, ".kiwi", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi", "runs"))).toBe(true);
    expect(existsSync(kiwiPolicyPath(cwd))).toBe(false);
    expect(existsSync(kiwiModelRegistryPath(cwd))).toBe(false);
    expect(existsSync(kiwiHomePolicyPath(env))).toBe(true);
    expect(existsSync(kiwiHomeModelRegistryPath(env))).toBe(true);
    expect(existsSync(path.join(cwd, "kiwi-policy.yaml"))).toBe(false);
    expect(existsSync(path.join(cwd, "model-registry.yaml"))).toBe(false);
    expectMcpLaunchForWorkspace(readCursorMcpConfig(cwd).mcpServers?.kiwi, cwd);
    expectMcpLaunchForWorkspace(readClaudeCodeMcpConfig(cwd).mcpServers?.kiwi, cwd);
    expect(readCodexConfig(cwd).content).toContain("[mcp_servers.kiwi]");
  });

  it("is idempotent and preserves user-edited policy/registry by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-idempotent-"));
    await runInitForTest({}, cwd);

    const policyPath = kiwiPolicyPath(cwd);
    const registryPath = kiwiModelRegistryPath(cwd);
    const configPath = path.join(cwd, ".kiwi", "config.yaml");

    const customPolicy = `version: "1"
project:
  name: custom
  language: typescript
  packageManager: pnpm
commands:
  test: pnpm test
  lint: pnpm lint
  typecheck: pnpm typecheck
routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  stepTypeOverrides: {}
riskZones:
  high: []
approvals:
  requireFor: []
`;
    const customRegistry = `version: "1"
models:
  - id: custom-mid
    provider: stub
    capability: mid
    roles: [executor]
    enabled: true
`;

    writeFileSync(policyPath, customPolicy, "utf-8");
    writeFileSync(registryPath, customRegistry, "utf-8");

    const configBefore = readFileSync(configPath, "utf-8");
    await runInitForTest({}, cwd);
    const configAfter = readFileSync(configPath, "utf-8");

    expect(readFileSync(policyPath, "utf-8")).toBe(customPolicy);
    expect(readFileSync(registryPath, "utf-8")).toBe(customRegistry);
    expect(configAfter).toBe(configBefore);
  });

  it("regenerates home defaults with --force and preserves workspace overrides", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-force-"));
    const env = testEnv(cwd);
    await runInitForTest({}, cwd);

    const policyPath = kiwiHomePolicyPath(env);
    const registryPath = kiwiHomeModelRegistryPath(env);
    const workspacePolicyPath = kiwiPolicyPath(cwd);

    writeFileSync(policyPath, 'version: "1"\nproject: {}\n', "utf-8");
    writeFileSync(registryPath, 'version: "1"\nmodels: []\n', "utf-8");
    writeFileSync(workspacePolicyPath, "commands:\n  test: npm test\n", "utf-8");

    await runInitForTest({ force: true }, cwd);

    expect(readFileSync(policyPath, "utf-8")).toContain("defaultAgentRole: executor");
    expect(readFileSync(registryPath, "utf-8")).toContain("capability: frontier");
    expect(readFileSync(workspacePolicyPath, "utf-8")).toBe("commands:\n  test: npm test\n");
  });

  it("writes policy and registry that validate against contracts", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-contracts-"));
    const env = testEnv(cwd);
    await runInitForTest({}, cwd);

    const policy = loadEffectivePolicy(cwd, { env });
    const registry = loadEffectiveRegistry(cwd, { env });

    expect(policy.version).toBe("1");
    expect(registry.models.length).toBeGreaterThan(0);
    expect(registry.models.some((model) => model.accessMode === "codex-cli")).toBe(true);
    expect(registry.models.filter((model) => model.accessMode === "codex-cli").map((model) => model.id)).toEqual([
      "codex-cli-cheap",
      "codex-cli-mid",
      "codex-cli-strong",
      "codex-cli-frontier",
    ]);
    expect(registry.models.find((model) => model.id === "codex-cli-cheap")?.enabled).toBe(false);
    expect(
      registry.models.filter((model) => model.accessMode === "codex-cli").every((model) => !model.providerModel),
    ).toBe(true);
    expect(policy.execution).toMatchObject({
      owner: "kiwi-codex-cli",
      isolation: "direct",
      sandbox: "workspace-write",
      forbidCommits: true,
      forbidPushes: true,
      forbidStaging: true,
    });
  });

  it("initializes an explicit workspace root", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cwd-"));
    const workspace = path.join(cwd, "workspace");
    mkdirSync(workspace);

    await runInitForTest({ workspace: "workspace" }, cwd);

    expect(existsSync(path.join(workspace, ".kiwi", "config.yaml"))).toBe(true);
    expect(existsSync(kiwiPolicyPath(workspace))).toBe(false);
    expect(existsSync(kiwiModelRegistryPath(workspace))).toBe(false);
    expect(existsSync(kiwiHomePolicyPath(testEnv(cwd)))).toBe(true);
    expect(existsSync(kiwiHomeModelRegistryPath(testEnv(cwd)))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi"))).toBe(false);
  });

  it("sets the default approver identity in workspace config", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-approver-"));
    await runInitForTest({}, cwd);

    await runConfigSetApprover("norbert", {}, cwd);

    expect(loadKiwiConfig(path.join(cwd, ".kiwi", "config.yaml")).approver?.identity).toBe("norbert");
  });

  it("sets the default approver identity from the local git user during init", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-git-approver-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "--local", "user.name", "Kiwi User"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "--local", "user.email", "kiwi@example.com"], { cwd, stdio: "ignore" });

    await runInitForTest({}, cwd);

    expect(loadKiwiConfig(path.join(cwd, ".kiwi", "config.yaml")).approver?.identity).toBe(
      "Kiwi User <kiwi@example.com>",
    );
  });

  it("adds a git-derived approver to existing config without overwriting configured identities", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-existing-approver-"));

    await runInitForTest({}, cwd);
    expect(loadKiwiConfig(path.join(cwd, ".kiwi", "config.yaml")).approver?.identity).toBeUndefined();

    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "--local", "user.name", "Kiwi User"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "--local", "user.email", "kiwi@example.com"], { cwd, stdio: "ignore" });
    await runInitForTest({}, cwd);
    expect(loadKiwiConfig(path.join(cwd, ".kiwi", "config.yaml")).approver?.identity).toBe(
      "Kiwi User <kiwi@example.com>",
    );

    await runConfigSetApprover("manual-operator", {}, cwd);
    execFileSync("git", ["config", "--local", "user.email", "other@example.com"], { cwd, stdio: "ignore" });
    await runInitForTest({}, cwd);

    expect(loadKiwiConfig(path.join(cwd, ".kiwi", "config.yaml")).approver?.identity).toBe("manual-operator");
  });

  it("writes Cursor MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cursor-"));

    await runInitForTest({ mcp: "cursor" }, cwd);

    const config = readCursorMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("uses installed kiwi-mcp-stdio wrapper when configured", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-installed-mcp-"));
    const binDir = path.join(cwd, "bin");
    const kiwiMcpBin = path.join(binDir, "kiwi-mcp-stdio");
    mkdirSync(binDir);
    writeFileSync(kiwiMcpBin, "#!/usr/bin/env sh\n", "utf-8");
    chmodSync(kiwiMcpBin, 0o755);

    await withKiwiMcpBin(kiwiMcpBin, async () => {
      await runInitForTest({ mcp: "all" }, cwd);
    });

    const config = readCursorMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expect(server?.type).toBe("stdio");
    expect(server?.command).toBe(kiwiMcpBin);
    expect(server?.args).toEqual(["--workspace", cwd]);
    expect(server?.env).toBeUndefined();

    const claudeConfig = readClaudeCodeMcpConfig(cwd);
    expect(claudeConfig.mcpServers?.kiwi?.command).toBe(kiwiMcpBin);
    expect(claudeConfig.mcpServers?.kiwi?.args).toEqual(["--workspace", cwd]);

    const codexConfig = readCodexConfig(cwd).content;
    expect(codexConfig).toContain(`command = "${kiwiMcpBin}"`);
    expect(codexConfig).toContain(`args = ["--workspace", "${cwd}"]`);
  });

  it("falls back to source MCP launch when no installed wrapper is configured", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-source-mcp-"));

    await withKiwiMcpBin(undefined, async () => {
      await runInitForTest({ mcp: "cursor" }, cwd);
    });

    const config = readCursorMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expect(server?.command).not.toContain("kiwi-mcp-stdio");
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("writes Claude Code MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-claude-"));

    await runInitForTest({ mcp: "claude" }, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("writes Codex MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-"));

    await runInitForTest({ mcp: "codex" }, cwd);

    const config = readCodexConfig(cwd).content;
    expect(config).toContain("[mcp_servers.kiwi]");
    expect(config).toContain("command = ");
    expect(config).toContain("args = ");
    expect(config).toContain(cwd);
  });

  it("merges Cursor MCP config without dropping existing servers", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cursor-merge-"));
    const cursorDir = path.join(cwd, ".cursor");
    mkdirSync(cursorDir);
    writeFileSync(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    await runInitForTest({ mcp: "cursor" }, cwd);

    const config = readCursorMcpConfig(cwd);
    expect(config.mcpServers?.existing?.args).toEqual(["existing.js"]);
    expectMcpLaunchForWorkspace(config.mcpServers?.kiwi, cwd);
  });

  it("merges Claude Code MCP config without dropping existing servers", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-claude-merge-"));
    writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    await runInitForTest({ mcp: "claude" }, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    expect(config.mcpServers?.existing?.args).toEqual(["existing.js"]);
    expectMcpLaunchForWorkspace(config.mcpServers?.kiwi, cwd);
  });

  it("merges Codex MCP config without dropping existing tables", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-merge-"));
    const codexDir = path.join(cwd, ".codex");
    mkdirSync(codexDir);
    writeFileSync(path.join(codexDir, "config.toml"), '[profiles.default]\nmodel = "gpt-5.4"\n', "utf-8");

    await runInitForTest({ mcp: "codex" }, cwd);

    const config = readCodexConfig(cwd).content;
    expect(config).toContain("[profiles.default]");
    expect(config).toContain('model = "gpt-5.4"');
    expect(config).toContain("[mcp_servers.kiwi]");
  });

  it("skips MCP client config with --mcp none", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-no-mcp-"));

    await runInitForTest({ mcp: "none" }, cwd);

    expect(existsSync(path.join(cwd, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(path.join(cwd, ".mcp.json"))).toBe(false);
    expect(existsSync(path.join(cwd, ".codex", "config.toml"))).toBe(false);
  });

  it("reports selected MCP client readiness and next steps", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-readiness-"));
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };

    try {
      await runInitForTest({ env: { PATH: "/empty" } }, cwd);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("MCP client readiness");
    expect(output).toContain("Cursor");
    expect(output).toContain("Claude Code");
    expect(output).toContain("Codex");
    expect(output).toContain("not detected");
    expect(output).toContain("Install Codex CLI");
    expect(output).toContain("kiwi doctor");
  });

  it("updates an existing gitignore with local Kiwi artifacts", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-gitignore-"));
    const gitignorePath = path.join(cwd, ".gitignore");
    writeFileSync(gitignorePath, "node_modules/\n.kiwi/\n", "utf-8");

    await runInitForTest({ mcp: "none" }, cwd);

    expect(readFileSync(gitignorePath, "utf-8")).toBe(["node_modules/", ".kiwi/", ""].join("\n"));
  });

  it("ignores workspace-nested custom KIWI_HOME", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-nested-home-"));
    const env = { KIWI_HOME: path.join(cwd, "home") };

    await runInitForTest({ mcp: "none", env }, cwd);

    expect(existsSync(kiwiHomePolicyPath(env))).toBe(true);
    expect(readFileSync(path.join(cwd, ".gitignore"), "utf-8")).toBe([".kiwi/", "home/", ""].join("\n"));
  });

  it("adds MCP config entries to gitignore by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-gitignore-mcp-"));
    const gitignorePath = path.join(cwd, ".gitignore");
    writeFileSync(gitignorePath, "node_modules/\n", "utf-8");

    await runInitForTest({}, cwd);

    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      ["node_modules/", ".kiwi/", ".cursor/mcp.json", ".mcp.json", ".codex/config.toml", ""].join("\n"),
    );
  });

  it("uses local git exclude instead of dirtying tracked gitignore", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-git-exclude-"));
    const gitignorePath = path.join(cwd, ".gitignore");
    writeFileSync(gitignorePath, "node_modules/\n", "utf-8");
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "feature/test"], { cwd, stdio: "ignore" });
    execFileSync("git", ["add", ".gitignore"], { cwd, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Kiwi", "-c", "user.email=kiwi@example.com", "commit", "-m", "initial"], {
      cwd,
      stdio: "ignore",
    });

    await runInitForTest({}, cwd);

    expect(readFileSync(gitignorePath, "utf-8")).toBe("node_modules/\n");
    const excludePath = execFileSync("git", ["-C", cwd, "rev-parse", "--git-path", "info/exclude"], {
      encoding: "utf-8",
    }).trim();
    expect(readFileSync(path.join(cwd, excludePath), "utf-8")).toContain(".cursor/mcp.json");
    expect(execFileSync("git", ["status", "--short"], { cwd, encoding: "utf-8" })).toBe("");
  });

  it("creates gitignore entries when none exists", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-no-gitignore-"));

    await runInitForTest({}, cwd);

    expect(readFileSync(path.join(cwd, ".gitignore"), "utf-8")).toBe(
      [".kiwi/", ".cursor/mcp.json", ".mcp.json", ".codex/config.toml", ""].join("\n"),
    );
  });
});
