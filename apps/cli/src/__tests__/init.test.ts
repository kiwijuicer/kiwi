import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { loadPolicy, loadRegistry } from "@kiwi/core";
import { runInit } from "../commands/init";

interface CursorMcpConfig {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
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

    writeFileSync(policyPath, "version: \"1\"\nproject: {}\n", "utf-8");
    writeFileSync(registryPath, "version: \"1\"\nmodels: []\n", "utf-8");

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
    expect(server?.command).toMatch(/^(node|pnpm)$/);
    expect(server?.args?.join(" ")).toContain("mcp-server");
    expect(server?.env).toEqual({ KIWI_WORKSPACE: "${workspaceFolder}" });
  });

  it("writes Claude Code MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-claude-"));

    await runInit({}, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    const server = config.mcpServers?.kiwi;
    expect(server?.command).toMatch(/^(node|pnpm)$/);
    expect(server?.args?.join(" ")).toContain("mcp-server");
    expect(server?.env).toEqual({ KIWI_WORKSPACE: cwd });
  });

  it("writes Codex MCP config for the workspace", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-"));

    await runInit({}, cwd);

    const config = readCodexConfig(cwd).content;
    expect(config).toContain("[mcp_servers.kiwi]");
    expect(config).toContain("command = ");
    expect(config).toContain("args = ");
    expect(config).toContain(`env = { KIWI_WORKSPACE = "${cwd}" }`);
  });

  it("merges Cursor MCP config without dropping existing servers", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-cursor-merge-"));
    const cursorDir = path.join(cwd, ".cursor");
    mkdirSync(cursorDir);
    writeFileSync(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
        },
      }, null, 2),
      "utf-8",
    );

    await runInit({}, cwd);

    const config = readCursorMcpConfig(cwd);
    expect(config.mcpServers?.existing?.args).toEqual(["existing.js"]);
    expect(config.mcpServers?.kiwi?.env).toEqual({ KIWI_WORKSPACE: "${workspaceFolder}" });
  });

  it("merges Claude Code MCP config without dropping existing servers", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-claude-merge-"));
    writeFileSync(
      path.join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
        },
      }, null, 2),
      "utf-8",
    );

    await runInit({}, cwd);

    const config = readClaudeCodeMcpConfig(cwd);
    expect(config.mcpServers?.existing?.args).toEqual(["existing.js"]);
    expect(config.mcpServers?.kiwi?.env).toEqual({ KIWI_WORKSPACE: cwd });
  });

  it("merges Codex MCP config without dropping existing tables", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-codex-merge-"));
    const codexDir = path.join(cwd, ".codex");
    mkdirSync(codexDir);
    writeFileSync(
      path.join(codexDir, "config.toml"),
      "[profiles.default]\nmodel = \"gpt-5.4\"\n",
      "utf-8",
    );

    await runInit({}, cwd);

    const config = readCodexConfig(cwd).content;
    expect(config).toContain("[profiles.default]");
    expect(config).toContain("model = \"gpt-5.4\"");
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

    expect(readFileSync(gitignorePath, "utf-8")).toBe([
      "node_modules/",
      ".kiwi/",
      ".cursor/mcp.json",
      ".mcp.json",
      ".codex/config.toml",
      "",
    ].join("\n"));
  });

  it("does not create gitignore when none exists", async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-cli-init-no-gitignore-"));

    await runInit({}, cwd);

    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(false);
  });
});
