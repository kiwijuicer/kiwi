import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadPolicy, loadRegistry } from "@kiwi/core";
import { runInit } from "../commands/init";

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

function expectMcpLaunchForWorkspace(
  server: NonNullable<CursorMcpConfig["mcpServers"]>[string] | undefined,
  cwd: string,
): void {
  expect(server?.type).toBe("stdio");
  if (server?.command?.endsWith("kiwi-mcp")) {
    expect(server.args).toEqual(["--workspace", cwd]);
    expect(server.env).toBeUndefined();
    return;
  }
  expect(server?.args?.join(" ")).toContain("mcp-server");
  if (server?.args?.some((arg) => arg.endsWith("stdio-launcher.cjs"))) {
    expect(server.command).toBe(process.execPath);
    expect(server.args).toContain("--workspace");
    expect(server.args).toContain(cwd);
    expect(server.env).toBeUndefined();
    return;
  }
  expect(server?.env).toEqual({ KIWI_WORKSPACE: cwd });
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
  it("creates .kiwi and default config files", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-"));

    await runInit({}, cwd);

    expect(existsSync(path.join(cwd, ".kiwi", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi", "runs"))).toBe(true);
    expect(existsSync(path.join(cwd, "kiwi-policy.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, "model-registry.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, ".cursor", "mcp.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".mcp.json"))).toBe(true);
    expect(existsSync(path.join(cwd, ".codex", "config.toml"))).toBe(true);
  });

  it("is idempotent and preserves user-edited policy/registry by default", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-idempotent-"));
    await runInit({}, cwd);

    const policyPath = path.join(cwd, "kiwi-policy.yaml");
    const registryPath = path.join(cwd, "model-registry.yaml");
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
    await runInit({}, cwd);
    const configAfter = readFileSync(configPath, "utf-8");

    expect(readFileSync(policyPath, "utf-8")).toBe(customPolicy);
    expect(readFileSync(registryPath, "utf-8")).toBe(customRegistry);
    expect(configAfter).toBe(configBefore);
  });

  it("regenerates config files with --force", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-force-"));
    await runInit({}, cwd);

    const policyPath = path.join(cwd, "kiwi-policy.yaml");
    const registryPath = path.join(cwd, "model-registry.yaml");

    writeFileSync(policyPath, 'version: "1"\nproject: {}\n', "utf-8");
    writeFileSync(registryPath, 'version: "1"\nmodels: []\n', "utf-8");

    await runInit({ force: true }, cwd);

    expect(readFileSync(policyPath, "utf-8")).toContain("defaultAgentRole: executor");
    expect(readFileSync(registryPath, "utf-8")).toContain("capability: frontier");
  });

  it("writes policy and registry that validate against contracts", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-contracts-"));
    await runInit({}, cwd);

    const policy = loadPolicy(path.join(cwd, "kiwi-policy.yaml"));
    const registry = loadRegistry(path.join(cwd, "model-registry.yaml"));

    expect(policy.version).toBe("1");
    expect(registry.models.length).toBeGreaterThan(0);
    expect(registry.models.some((model) => model.accessMode === "anthropic-api")).toBe(false);
    expect(registry.models.some((model) => model.accessMode === "codex-cli")).toBe(true);
  });

  it("initializes an explicit workspace root", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cwd-"));
    const workspace = path.join(cwd, "voice");
    mkdirSync(workspace);

    await runInit({ workspace: "voice" }, cwd);

    expect(existsSync(path.join(workspace, ".kiwi", "config.yaml"))).toBe(true);
    expect(existsSync(path.join(workspace, "kiwi-policy.yaml"))).toBe(true);
    expect(existsSync(path.join(cwd, ".kiwi"))).toBe(false);
  });

  it("writes Cursor MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cursor-"));

    await runInit({}, cwd);

    const config = readCursorMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("uses installed kiwi-mcp wrapper when configured", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-installed-mcp-"));
    const binDir = path.join(cwd, "bin");
    const kiwiMcpBin = path.join(binDir, "kiwi-mcp");
    mkdirSync(binDir);
    writeFileSync(kiwiMcpBin, "#!/usr/bin/env sh\n", "utf-8");
    chmodSync(kiwiMcpBin, 0o755);

    await withKiwiMcpBin(kiwiMcpBin, async () => {
      await runInit({}, cwd);
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
      await runInit({}, cwd);
    });

    const config = readCursorMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expect(server?.command).not.toContain("kiwi-mcp");
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("writes Claude Code MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-claude-"));

    await runInit({}, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expectMcpLaunchForWorkspace(server, cwd);
  });

  it("writes Codex MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-"));

    await runInit({}, cwd);

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

    await runInit({}, cwd);

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

    await runInit({}, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    expect(config.mcpServers?.existing?.args).toEqual(["existing.js"]);
    expectMcpLaunchForWorkspace(config.mcpServers?.kiwi, cwd);
  });

  it("merges Codex MCP config without dropping existing tables", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-merge-"));
    const codexDir = path.join(cwd, ".codex");
    mkdirSync(codexDir);
    writeFileSync(path.join(codexDir, "config.toml"), '[profiles.default]\nmodel = "gpt-5.4"\n', "utf-8");

    await runInit({}, cwd);

    const config = readCodexConfig(cwd).content;
    expect(config).toContain("[profiles.default]");
    expect(config).toContain('model = "gpt-5.4"');
    expect(config).toContain("[mcp_servers.kiwi]");
  });

  it("can skip MCP client config", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-no-mcp-"));

    await runInit({ cursorMcp: false, claudeCodeMcp: false, codexMcp: false }, cwd);

    expect(existsSync(path.join(cwd, ".cursor", "mcp.json"))).toBe(false);
    expect(existsSync(path.join(cwd, ".mcp.json"))).toBe(false);
    expect(existsSync(path.join(cwd, ".codex", "config.toml"))).toBe(false);
  });

  it("updates an existing gitignore with local Kiwi artifacts", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-gitignore-"));
    const gitignorePath = path.join(cwd, ".gitignore");
    writeFileSync(gitignorePath, "node_modules/\n.kiwi/\n", "utf-8");

    await runInit({}, cwd);

    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      ["node_modules/", ".kiwi/", ".cursor/mcp.json", ".mcp.json", ".codex/config.toml", ""].join("\n"),
    );
  });

  it("does not create gitignore when none exists", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-no-gitignore-"));

    await runInit({}, cwd);

    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(false);
  });
});
