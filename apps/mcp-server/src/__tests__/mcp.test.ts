import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { once } from "events";
import { AddressInfo } from "net";
import { execFileSync } from "child_process";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { kiwiModelRegistryPath, kiwiPolicyPath } from "@kiwi/core";
import {
  createMcpMessageDrainer,
  handleMcpRequest,
  McpServerBootstrap,
  resolveMcpBootstrapOptions,
  startHttpMcpServer,
} from "../index";

function setupRepo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-"));
  writeKiwiConfig(cwd);
  initCleanGitRepo(cwd);

  return cwd;
}

function initCleanGitRepo(cwd: string): void {
  writeFileSync(path.join(cwd, ".gitignore"), ".kiwi/\n", "utf-8");
  execFileSync("git", ["init", "-b", "feature"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "kiwi@example.test"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "kiwi"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
}

function writeKiwiConfig(cwd: string): void {
  mkdirSync(path.join(cwd, ".kiwi", "runs"), { recursive: true });
  mkdirSync(path.join(cwd, ".kiwi", "logs"), { recursive: true });
  writeFileSync(path.join(cwd, ".kiwi", "config.yaml"), 'version: "1"\n', "utf-8");
  writeFileSync(
    kiwiPolicyPath(cwd),
    `version: "1"
project:
  name: kiwi
  language: typescript
  packageManager: pnpm
commands:
  test: node -e 0
  lint: node -e 0
  typecheck: node -e 0
routing:
  defaultAgentRole: executor
  defaultModelCapability: mid
  stepTypeOverrides: {}
riskZones:
  high: []
approvals:
  requireFor: []
  commandApprovalStates: {}
commandProfiles:
  default:
    allowedCommands: [node]
    approvalState: auto
    approvalRequiredPaths: []
    deniedPaths: []
    envAllowlist: [PATH]
    secretEnvNames: []
    networkPolicy: disabled
    timeoutMs: 1000
    maxOutputBytes: 4096
`,
    "utf-8",
  );
  writeFileSync(
    kiwiModelRegistryPath(cwd),
    `version: "1"
models:
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer]
    enabled: true
`,
    "utf-8",
  );
}

function setupWorkspace(): { root: string; core: string; agent: string } {
  const root = setupRepo();
  const core = path.join(root, "voice-core");
  const agent = path.join(root, "voice-livekit-agent");
  mkdirSync(core);
  mkdirSync(agent);
  writeFileSync(path.join(core, "core.txt"), "core\n", "utf-8");
  writeFileSync(path.join(agent, "agent.txt"), "agent\n", "utf-8");
  writeFileSync(
    path.join(root, "workspace.code-workspace"),
    JSON.stringify({
      folders: [
        { name: "voice-core", path: "voice-core" },
        { name: "voice-livekit-agent", path: "voice-livekit-agent" },
      ],
    }),
    "utf-8",
  );
  execFileSync("git", ["add", "voice-core/core.txt", "voice-livekit-agent/agent.txt", "workspace.code-workspace"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "workspace"], { cwd: root, stdio: "ignore" });

  return { root, core, agent };
}

function toolJson(response: Awaited<ReturnType<typeof handleMcpRequest>>): unknown {
  const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";

  return JSON.parse(text) as unknown;
}

function lineMessage(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf-8");
}

function isLoopbackListenPermissionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

async function startLoopbackHttpServer(
  cwd: string,
  skip: () => void,
): Promise<ReturnType<typeof startHttpMcpServer> | null> {
  const server = startHttpMcpServer({ cwd, host: "127.0.0.1", port: 0, authToken: "test-token" });

  try {
    await once(server, "listening");

    return server;
  } catch (error) {
    if (isLoopbackListenPermissionError(error)) {
      skip();

      return null;
    }
    throw error;
  }
}

describe("MCP server", () => {
  it("declares tools, resources, and progress capabilities", async () => {
    const initialized = await handleMcpRequest({ id: 1, method: "initialize", params: {} }, setupRepo());

    expect(initialized.result).toMatchObject({
      capabilities: { resources: {}, tools: {}, progress: {} },
    });
  });

  it("resolves stdio bootstrap options by default", () => {
    const options = resolveMcpBootstrapOptions(["node", "index.js"], { KIWI_WORKSPACE: "/workspace" });

    expect(options).toMatchObject({
      cwd: "/workspace",
      transport: "stdio",
    });
  });

  it("resolves explicit stdio bootstrap options", () => {
    const options = resolveMcpBootstrapOptions(
      ["node", "index.js", "--transport", "stdio", "--workspace", "/repo"],
      {},
    );

    expect(options).toMatchObject({
      cwd: "/repo",
      transport: "stdio",
    });
  });

  it("resolves HTTP bootstrap options", () => {
    const options = resolveMcpBootstrapOptions(
      ["node", "index.js", "--transport", "http", "--workspace", "/repo", "--host", "127.0.0.1", "--port", "0"],
      { KIWI_MCP_HTTP_TOKEN: "token" },
    );

    expect(options).toMatchObject({
      cwd: "/repo",
      transport: "http",
      http: {
        cwd: "/repo",
        host: "127.0.0.1",
        port: 0,
        authToken: "token",
      },
    });
  });

  it("rejects unknown bootstrap transports", () => {
    expect(() => resolveMcpBootstrapOptions(["node", "index.js", "--transport", "nonsense"], {})).toThrow(
      "Unsupported MCP transport: nonsense",
    );
  });

  it("rejects removed streamable HTTP alias", () => {
    expect(() => resolveMcpBootstrapOptions(["node", "index.js", "--transport", "streamable-http"], {})).toThrow(
      "Expected one of: stdio, http",
    );
  });

  it("resolves bootstrap options in the constructor before starting stdio", () => {
    const started: string[] = [];
    const bootstrap = new McpServerBootstrap(
      resolveMcpBootstrapOptions(["node", "index.js", "--workspace", "/repo"], {}),
      {
        transports: {
          startStdio: (cwd) => started.push(cwd),
        },
      },
    );

    bootstrap.start();

    expect(started).toEqual(["/repo"]);
  });

  it("starts HTTP from constructor-resolved bootstrap options", () => {
    const started: unknown[] = [];
    const bootstrap = new McpServerBootstrap(
      resolveMcpBootstrapOptions(["node", "index.js", "--transport", "http", "--workspace", "/repo", "--port", "0"], {
        KIWI_MCP_HTTP_TOKEN: "token",
      }),
      {
        transports: {
          startHttp: (options) => started.push(options),
        },
      },
    );

    bootstrap.start();

    expect(started).toEqual([{ cwd: "/repo", port: 0, authToken: "token" }]);
  });

  it("initializes and lists tools", async () => {
    const response = await handleMcpRequest({ id: 1, method: "initialize" }, setupRepo());
    expect(response.error).toBeUndefined();
    expect((response.result as { serverInfo: { name: string } }).serverInfo.name).toBe("kiwi");

    const tools = await handleMcpRequest({ id: 2, method: "tools/list" }, setupRepo());
    expect(tools.error).toBeUndefined();
    expect(JSON.stringify(tools.result)).toContain("kiwi_plan");
    expect(JSON.stringify(tools.result)).toContain("inputSchema");
    const listedTools = (
      tools.result as {
        tools: Array<{ name: string; annotations?: unknown; inputSchema?: { additionalProperties?: boolean } }>;
      }
    ).tools;
    expect(listedTools.every((tool) => tool.annotations)).toBe(true);
    expect(listedTools.every((tool) => tool.inputSchema?.additionalProperties === false)).toBe(true);
    expect(listedTools.find((tool) => tool.name === "kiwi_next")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(listedTools.find((tool) => tool.name === "kiwi_request_approval")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("lists concrete resources separately from templates", async () => {
    const cwd = setupRepo();
    const resources = await handleMcpRequest({ id: 1, method: "resources/list" }, cwd);
    expect(resources.error).toBeUndefined();
    expect(JSON.stringify(resources.result)).toContain("kiwi://runs");
    expect(JSON.stringify(resources.result)).not.toContain("{runId}");

    const templates = await handleMcpRequest({ id: 2, method: "resources/templates/list" }, cwd);
    expect(templates.error).toBeUndefined();
    expect(JSON.stringify(templates.result)).toContain("resourceTemplates");
    expect(JSON.stringify(templates.result)).toContain("uriTemplate");
    expect(JSON.stringify(templates.result)).toContain("kiwi://runs/{runId}");
  });

  it("returns structured invalid params errors for malformed tool payloads", async () => {
    const response = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { workspacePath: setupRepo() },
        },
      },
      setupRepo(),
    );

    expect(response.error?.code).toBe(-32602);
    expect(response.error?.message).toBe("Invalid params");
    const issues = (response.error?.data as { issues?: Array<{ path?: unknown[] }> } | undefined)?.issues ?? [];
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).toContain("ticket");
  });

  it("drains multiple newline-delimited stdio messages and skips notifications", async () => {
    const responses: unknown[] = [];
    const drain = createMcpMessageDrainer(setupRepo(), (response) => responses.push(response));

    await drain(
      Buffer.concat([
        lineMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        lineMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
        lineMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      ]),
    );

    expect(responses).toHaveLength(2);
    expect(responses.map((response) => (response as { id: number }).id)).toEqual([1, 2]);
    expect(JSON.stringify(responses[1])).toContain("kiwi_plan");
  });

  it("drains batched stdio messages", async () => {
    const responses: unknown[] = [];
    const drain = createMcpMessageDrainer(setupRepo(), (response) => responses.push(response));

    await drain(
      lineMessage([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]),
    );

    expect(responses).toHaveLength(1);
    expect((responses[0] as Array<{ id: number }>).map((response) => response.id)).toEqual([1, 2]);
  });

  it("rejects oversized stdio lines and continues after the newline", async () => {
    const responses: unknown[] = [];
    const drain = createMcpMessageDrainer(setupRepo(), (response) => responses.push(response));
    const oversizedLine = Buffer.alloc(4 * 1024 * 1024 + 1, "x");

    await drain(
      Buffer.concat([
        oversizedLine,
        Buffer.from("\n", "utf-8"),
        lineMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      ]),
    );

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ error: { code: -32600, message: "Invalid request" } });
    expect(responses[1]).toMatchObject({ id: 1, result: { serverInfo: { name: "kiwi" } } });
  });

  it("discards split oversized stdio lines until the newline", async () => {
    const responses: unknown[] = [];
    const drain = createMcpMessageDrainer(setupRepo(), (response) => responses.push(response));

    await drain(Buffer.alloc(4 * 1024 * 1024 + 1, "x"));
    await drain(
      Buffer.concat([
        Buffer.from("still-discarded\n", "utf-8"),
        lineMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      ]),
    );

    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ error: { code: -32600, message: "Invalid request" } });
    expect(responses[1]).toMatchObject({ id: 1, result: { serverInfo: { name: "kiwi" } } });
  });

  it("serves streamable HTTP POST requests", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const body = await response.text();
      const payload = JSON.parse(body.match(/data: (.+)/)?.[1] ?? "{}") as {
        result: { protocolVersion: string; serverInfo: { name: string } };
      };
      expect(payload.result.protocolVersion).toBe("2025-03-26");
      expect(payload.result.serverInfo.name).toBe("kiwi");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("refuses to start HTTP transport without a bearer token", () => {
    const previousToken = process.env.KIWI_MCP_HTTP_TOKEN;
    delete process.env.KIWI_MCP_HTTP_TOKEN;
    try {
      expect(() => startHttpMcpServer({ cwd: setupRepo(), host: "127.0.0.1", port: 0 })).toThrow(
        "KIWI_MCP_HTTP_TOKEN is required",
      );
    } finally {
      if (previousToken === undefined) {
        delete process.env.KIWI_MCP_HTTP_TOKEN;
      } else {
        process.env.KIWI_MCP_HTTP_TOKEN = previousToken;
      }
    }
  });

  it("returns 202 for HTTP notification-only input", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      });

      expect(response.status).toBe(202);
      expect(await response.text()).toBe("");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("allows IPv6 loopback Origin headers", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "OPTIONS",
        headers: {
          origin: "http://[::1]:3000",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://[::1]:3000");
      expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("does not advertise GET on the HTTP MCP endpoint", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "GET",
        headers: {
          authorization: "Bearer test-token",
        },
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects unauthenticated HTTP POST requests", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });

      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects wrong bearer tokens", async ({ skip }) => {
    const server = await startLoopbackHttpServer(setupRepo(), skip);

    if (!server) {
      return;
    }

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });

      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("plans, generates P1 artifacts, and reads parity resources", async () => {
    const cwd = setupRepo();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { ticket: "# MCP Feature\n\n## Validate" },
        },
      },
      cwd,
    );
    expect(planned.error).toBeUndefined();
    const text = (planned.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { runId: string };
    expect(parsed.runId).toMatch(/^run_/);

    const runs = await handleMcpRequest(
      {
        id: 2,
        method: "resources/read",
        params: { uri: "kiwi://runs" },
      },
      cwd,
    );
    expect(runs.error).toBeUndefined();
    expect(JSON.stringify(runs.result)).toContain(parsed.runId);

    const initiative = await handleMcpRequest(
      {
        id: 3,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/initiative` },
      },
      cwd,
    );
    expect(initiative.error).toBeUndefined();
    expect(JSON.stringify(initiative.result)).toContain("MCP Feature");

    const plannerOutput = await handleMcpRequest(
      {
        id: 4,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/planner-output` },
      },
      cwd,
    );
    expect(plannerOutput.error).toBeUndefined();
    expect(JSON.stringify(plannerOutput.result)).toContain("stub-deterministic");

    const evidence = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: {
          name: "kiwi_evidence_manifest",
          arguments: { runId: parsed.runId },
        },
      },
      cwd,
    );
    expect(evidence.error).toBeUndefined();

    const snapshot = await handleMcpRequest(
      {
        id: 6,
        method: "tools/call",
        params: {
          name: "kiwi_operator_snapshot",
          arguments: { runId: parsed.runId },
        },
      },
      cwd,
    );
    expect(snapshot.error).toBeUndefined();

    const evidenceResource = await handleMcpRequest(
      {
        id: 7,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/evidence-manifest` },
      },
      cwd,
    );
    expect(evidenceResource.error).toBeUndefined();
    expect(JSON.stringify(evidenceResource.result)).toContain("final/audit-events.json");

    const snapshotResource = await handleMcpRequest(
      {
        id: 8,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/operator-snapshot` },
      },
      cwd,
    );
    expect(snapshotResource.error).toBeUndefined();
    expect(JSON.stringify(snapshotResource.result)).toContain("<!doctype html>");
  });

  it("plans with object arguments and exposes model evidence resources", async () => {
    const cwd = setupRepo();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { rawInput: "# Raw MCP\n\n## Plan", budgetProfile: "tiny" },
        },
      },
      cwd,
    );
    expect(planned.error).toBeUndefined();
    const parsed = toolJson(planned) as {
      runId: string;
      workspace: { workspacePath: string; repoPath: string };
    };
    expect(parsed.workspace.workspacePath).toBe(cwd);
    expect(parsed.workspace.repoPath).toBe(cwd);

    const invocations = await handleMcpRequest(
      {
        id: 2,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/model-invocations` },
      },
      cwd,
    );
    const summary = await handleMcpRequest(
      {
        id: 3,
        method: "resources/read",
        params: { uri: `kiwi://runs/${parsed.runId}/model-usage-summary` },
      },
      cwd,
    );

    const invocationsText = (invocations.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? "";
    const summaryText = (summary.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? "";
    expect(invocationsText).toContain("stub-frontier");
    expect(summaryText).toContain('"invocationCount": 1');
  });

  it("rejects stringified and top-level fallback tool arguments", async () => {
    const cwd = setupRepo();
    const stringified = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: JSON.stringify({ rawInput: "# String MCP\n\n## Plan" }),
        },
      },
      cwd,
    );
    const topLevel = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          rawInput: "# Top Level MCP\n\n## Plan",
          riskProfile: "dev",
          budgetProfile: "tiny",
        },
      },
      cwd,
    );

    expect(stringified.error?.code).toBe(-32602);
    expect(topLevel.error?.code).toBe(-32602);
    expect(JSON.stringify(stringified.error?.data)).toContain("params.arguments must be an object");
  });

  it("emits progress notifications only when a progressToken is explicit", async () => {
    const cwd = setupRepo();
    const notifications: unknown[] = [];
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          _meta: { progressToken: "plan-progress" },
          name: "kiwi_plan",
          arguments: { rawInput: "# Progress MCP\n\n## Plan" },
        },
      },
      cwd,
      { sendNotification: (notification) => notifications.push(notification) },
    );
    expect(planned.error).toBeUndefined();
    const parsed = toolJson(planned) as { runId: string; cost: { estimatedCostUsd: number } };
    expect(parsed.cost.estimatedCostUsd).toBeTypeOf("number");
    expect(JSON.stringify(notifications)).toContain("notifications/progress");
    expect(JSON.stringify(notifications)).toContain("phase=planner status=started");
    expect(JSON.stringify(notifications)).toContain("phase=planner status=completed");
    expect(
      notifications.every(
        (notification) =>
          (notification as { params?: { progressToken?: unknown } }).params?.progressToken === "plan-progress",
      ),
    ).toBe(true);

    const omittedTokenNotifications: unknown[] = [];
    const omittedTokenPlan = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { rawInput: "# Progress omitted\n\n## Plan" },
        },
      },
      cwd,
      { sendNotification: (notification) => omittedTokenNotifications.push(notification) },
    );
    expect(omittedTokenPlan.error).toBeUndefined();
    expect(omittedTokenNotifications).toEqual([]);

    const nullTokenNotifications: unknown[] = [];
    const nullTokenPlan = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: {
          _meta: { progressToken: null },
          name: "kiwi_plan",
          arguments: { rawInput: "# Progress null\n\n## Plan" },
        },
      },
      cwd,
      { sendNotification: (notification) => nullTokenNotifications.push(notification) },
    );
    expect(nullTokenPlan.error).toBeUndefined();
    expect(nullTokenNotifications).toEqual([]);

    const resources = await handleMcpRequest({ id: 4, method: "resources/list" }, cwd);
    const taskGraphUri = `kiwi://runs/${parsed.runId}/artifacts/plan%2Ftask-graph.json`;
    expect(JSON.stringify(resources.result)).toContain(taskGraphUri);

    const taskGraph = await handleMcpRequest({ id: 5, method: "resources/read", params: { uri: taskGraphUri } }, cwd);
    expect(JSON.stringify(taskGraph.result)).toContain("Progress MCP");
  });

  it("lists concrete run resources", async () => {
    const cwd = setupRepo();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: { rawInput: "# Resource MCP\n\n## Plan" },
        },
      },
      cwd,
    );
    expect(planned.error).toBeUndefined();
    const parsed = toolJson(planned) as { runId: string; cost: { estimatedCostUsd: number } };
    expect(parsed.cost.estimatedCostUsd).toBeTypeOf("number");

    const resources = await handleMcpRequest({ id: 2, method: "resources/list" }, cwd);
    const taskGraphUri = `kiwi://runs/${parsed.runId}/artifacts/plan%2Ftask-graph.json`;
    expect(JSON.stringify(resources.result)).toContain(taskGraphUri);

    const taskGraph = await handleMcpRequest({ id: 3, method: "resources/read", params: { uri: taskGraphUri } }, cwd);
    expect(JSON.stringify(taskGraph.result)).toContain("Resource MCP");
  });

  it("returns MCP resource not found errors for missing artifacts", async () => {
    const cwd = setupRepo();
    const missing = await handleMcpRequest(
      { id: 1, method: "resources/read", params: { uri: "kiwi://runs/run_missing/artifacts/nope.json" } },
      cwd,
    );

    expect(missing.error?.code).toBe(-32002);
    expect(missing.error?.data).toMatchObject({ category: "resource_not_found" });
  });

  it("rejects path traversal run ids in resource URIs", async () => {
    const cwd = setupRepo();
    const escaped = await handleMcpRequest(
      { id: 1, method: "resources/read", params: { uri: "kiwi://runs/../artifacts/config.yaml" } },
      cwd,
    );

    expect(escaped.error?.code).toBe(-32002);
    expect(escaped.error?.data).toMatchObject({ category: "resource_not_found" });
    expect(JSON.stringify(escaped.result ?? "")).not.toContain('version: "1"');
  });

  it("previews Codex model switching before running", async () => {
    const cwd = setupRepo();
    writeFileSync(
      kiwiModelRegistryPath(cwd),
      `version: "1"
models:
  - id: stub-frontier
    provider: stub
    capability: frontier
    roles: [planner, reviewer]
    accessMode: stub
    enabled: true
  - id: codex-cli-mid
    providerModel: gpt-5.4-mini
    provider: local
    capability: mid
    roles: [executor, reviewer, researcher, rules]
    accessMode: codex-cli
    enabled: true
  - id: codex-cli-strong
    providerModel: gpt-5.4
    provider: local
    capability: strong
    roles: [executor, reviewer, planner, security, rules]
    accessMode: codex-cli
    enabled: true
`,
      "utf-8",
    );
    const previousFake = process.env.KIWI_FAKE_BINARY_AVAILABLE;
    const previousForce = process.env.KIWI_FORCE_ACCESS_MODE;
    process.env.KIWI_FAKE_BINARY_AVAILABLE = "1";
    try {
      const planned = await handleMcpRequest(
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "kiwi_plan",
            arguments: { rawInput: "# Preview MCP\n\n## Implement\n## Validate" },
          },
        },
        cwd,
      );
      expect(planned.error).toBeUndefined();
      const runId = (toolJson(planned) as { runId: string }).runId;
      process.env.KIWI_FORCE_ACCESS_MODE = "codex-cli";

      const preview = await handleMcpRequest(
        {
          id: 2,
          method: "tools/call",
          params: {
            name: "kiwi_preview_run",
            arguments: { runId, maxConcurrency: 2 },
          },
        },
        cwd,
      );

      expect(preview.error).toBeUndefined();
      const parsed = toolJson(preview) as {
        decision: { nextAction: { recommendedToolCall: { arguments: { maxConcurrency?: number } } } };
        execution: { isolation: string };
        previewToken: string;
        steps: Array<{ runner: string; selectedModelId: string; selectedProviderModel: string }>;
      };
      expect(parsed.execution.isolation).toBe("direct");
      expect(parsed.previewToken).toMatch(/^preview_/);
      expect(parsed.steps.some((step) => step.runner === "codex")).toBe(true);
      expect(parsed.steps.some((step) => step.selectedProviderModel === "gpt-5.4")).toBe(true);
      expect(parsed.decision.nextAction.recommendedToolCall.arguments.maxConcurrency).toBe(2);

      const next = await handleMcpRequest(
        {
          id: 3,
          method: "tools/call",
          params: {
            name: "kiwi_next",
            arguments: { runId, maxConcurrency: 2 },
          },
        },
        cwd,
      );
      const nextParsed = toolJson(next) as {
        nextAction: { recommendedToolCall: { name: string; arguments: { maxConcurrency?: number } } };
      };
      expect(nextParsed.nextAction.recommendedToolCall.name).toBe("kiwi_run");
      expect(nextParsed.nextAction.recommendedToolCall.arguments.maxConcurrency).toBe(2);

      const implicitPreview = await handleMcpRequest(
        {
          id: 4,
          method: "tools/call",
          params: {
            name: "kiwi_preview_run",
            arguments: { runId },
          },
        },
        cwd,
      );
      const implicitParsed = toolJson(implicitPreview) as {
        decision: { nextAction: { recommendedToolCall: { arguments: { maxConcurrency?: number } } } };
      };
      expect(implicitParsed.decision.nextAction.recommendedToolCall.arguments).not.toHaveProperty("maxConcurrency");
    } finally {
      if (previousFake === undefined) {
        delete process.env.KIWI_FAKE_BINARY_AVAILABLE;
      } else {
        process.env.KIWI_FAKE_BINARY_AVAILABLE = previousFake;
      }
      if (previousForce === undefined) {
        delete process.env.KIWI_FORCE_ACCESS_MODE;
      } else {
        process.env.KIWI_FORCE_ACCESS_MODE = previousForce;
      }
    }
  });

  it("rejects uninitialized workspacePath instead of falling back to initialized repoPath", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "kiwi-mcp-workspace-root-"));
    const core = path.join(workspaceRoot, "voice-core");
    mkdirSync(core);
    writeKiwiConfig(core);

    const rejected = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: {
            workspacePath: workspaceRoot,
            repoPath: core,
            rawInput: "# Workspace fallback rejected\n\n## Plan",
            riskProfile: "dev",
            budgetProfile: "tiny",
          },
        },
      },
      os.tmpdir(),
    );
    expect(rejected.error?.code).toBe(-32000);
    expect(rejected.error?.message).toContain("Workspace path is not initialized");
    expect(rejected.error?.message).toContain("kiwi_doctor");

    const planned = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: {
            workspacePath: core,
            repoId: "voice-core",
            repoPath: core,
            rawInput: "# Workspace direct\n\n## Plan",
            riskProfile: "dev",
            budgetProfile: "tiny",
          },
        },
      },
      os.tmpdir(),
    );

    expect(planned.error).toBeUndefined();
    const parsed = toolJson(planned) as {
      workspace: { workspacePath: string; repoId: string; repoPath: string };
    };
    expect(parsed.workspace.workspacePath).toBe(core);
    expect(parsed.workspace.repoId).toBe("voice-core");
    expect(parsed.workspace.repoPath).toBe(core);
  });

  it("accepts workspace selection and exposes kiwi_run", async () => {
    const workspace = setupWorkspace();
    const planned = await handleMcpRequest(
      {
        id: 1,
        method: "tools/call",
        params: {
          name: "kiwi_plan",
          arguments: {
            workspacePath: workspace.root,
            repoId: "voice-core",
            ticket: "# Workspace MCP\n\n## Implement",
          },
        },
      },
      os.tmpdir(),
    );
    expect(planned.error).toBeUndefined();
    const text = (planned.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { runId: string; workspace: { repoPath: string } };
    expect(parsed.workspace.repoPath).toBe(workspace.core);
    const preview = await handleMcpRequest(
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "kiwi_preview_run",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
            maxConcurrency: 2,
            command: "node -e 0",
          },
        },
      },
      os.tmpdir(),
    );
    const previewToken = (toolJson(preview) as { previewToken: string }).previewToken;

    const notifications: unknown[] = [];
    const run = await handleMcpRequest(
      {
        id: 3,
        method: "tools/call",
        params: {
          _meta: { progressToken: "run-progress" },
          name: "kiwi_run",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
            previewToken,
            command: "node -e 0",
            maxConcurrency: 2,
          },
        },
      },
      os.tmpdir(),
      { sendNotification: (notification) => notifications.push(notification) },
    );
    expect(run.error).toBeUndefined();
    expect(JSON.stringify(run.result)).toContain("completed");
    const runParsed = toolJson(run) as {
      steps: Array<{ stepId: string }>;
      summary: { totalEstimatedCostUsd: number; nextAction: string };
    };
    const notificationText = JSON.stringify(notifications);
    expect(notificationText).toContain("phase=run status=started");
    expect(notificationText).toContain("phase=routing status=selected");
    expect(notificationText).toContain("phase=step status=started");
    expect(notificationText).toContain("phase=gate status=");
    expect(notificationText).toContain("phase=review status=completed");
    expect(notificationText).toContain("run-progress");
    const routingStepIndices = notifications
      .map((notification) => (notification as { params?: { message?: unknown } }).params?.message)
      .filter((message): message is string => typeof message === "string" && message.includes("phase=routing"))
      .map((message) => Number(message.match(/stepIndex=(\d+)/)?.[1] ?? 0))
      .filter((index) => index > 0);

    expect(routingStepIndices).toHaveLength(runParsed.steps.length);
    expect(new Set(routingStepIndices).size).toBe(routingStepIndices.length);
    expect(runParsed.steps.map((step) => step.stepId)).toEqual([...runParsed.steps.map((step) => step.stepId)].sort());
    expect(runParsed.summary.totalEstimatedCostUsd).toBe(0);

    const worktrees = path.join(workspace.root, ".kiwi", "runs", parsed.runId, "worktrees");
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toHaveLength(0);

    const cost = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "kiwi_cost",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
          },
        },
      },
      os.tmpdir(),
    );
    expect(cost.error).toBeUndefined();
    expect(
      (toolJson(cost) as { summary: { phaseCostsUsd: { executor: number } } }).summary.phaseCostsUsd.executor,
    ).toBe(0);

    const explain = await handleMcpRequest(
      {
        id: 5,
        method: "tools/call",
        params: {
          name: "kiwi_explain",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
          },
        },
      },
      os.tmpdir(),
    );
    expect(explain.error).toBeUndefined();
    expect((toolJson(explain) as { explanation: { routing: unknown[] } }).explanation.routing.length).toBeGreaterThan(
      0,
    );

    for (const [index, name] of ["kiwi_finalize", "kiwi_evidence_manifest", "kiwi_operator_snapshot"].entries()) {
      const response = await handleMcpRequest(
        {
          id: 6 + index,
          method: "tools/call",
          params: {
            name,
            arguments: {
              workspacePath: workspace.root,
              runId: parsed.runId,
            },
          },
        },
        os.tmpdir(),
      );
      expect(response.error).toBeUndefined();
    }

    const next = await handleMcpRequest(
      {
        id: 9,
        method: "tools/call",
        params: {
          name: "kiwi_next",
          arguments: {
            workspacePath: workspace.root,
            runId: parsed.runId,
          },
        },
      },
      os.tmpdir(),
    );
    expect(next.error).toBeUndefined();
    expect((toolJson(next) as { nextAction: { recommendedToolCall: unknown } }).nextAction.recommendedToolCall).toBe(
      null,
    );
  });
});
