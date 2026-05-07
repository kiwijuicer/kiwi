import { execFileSync } from "child_process";
import { AccessMode, AccessModes, ModelEntry } from "@kiwi/contracts";

export interface AccessModeAvailability {
  accessMode: AccessMode;
  available: boolean;
  reason?: string;
}

const RECOGNIZED_BINARIES: Partial<Record<AccessMode, string>> = {
  [AccessModes.ClaudeCodeCli]: "claude",
  [AccessModes.CodexCli]: "codex",
  [AccessModes.CursorAgentCli]: "cursor-agent",
  [AccessModes.Cursor]: "cursor",
  [AccessModes.Jetbrains]: "phpstorm",
};

const ENV_KEY_FOR_API: Partial<Record<AccessMode, string>> = {
  [AccessModes.AnthropicApi]: "ANTHROPIC_API_KEY",
  [AccessModes.OpenaiApi]: "OPENAI_API_KEY",
};

function which(binary: string, env: Record<string, string | undefined>): boolean {
  if (env.KIWI_FAKE_BINARY_AVAILABLE === "1") return true;
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const args = [binary];
    execFileSync(cmd, args, { stdio: "ignore", env: selectedProbeEnv(env) });
    return true;
  } catch {
    return false;
  }
}

function selectedProbeEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function errorOutput(error: unknown): string {
  const parts: string[] = [];
  if (typeof error === "object" && error !== null) {
    const maybe = error as { stdout?: unknown; stderr?: unknown };
    for (const value of [maybe.stdout, maybe.stderr]) {
      if (Buffer.isBuffer(value)) parts.push(value.toString("utf-8"));
      if (typeof value === "string") parts.push(value);
    }
  }
  if (error instanceof Error) parts.push(error.message);
  else parts.push(String(error));
  return parts.filter(Boolean).join("\n");
}

function cursorAgentAuthAvailable(env: Record<string, string | undefined>): AccessModeAvailability {
  if (env.KIWI_FAKE_BINARY_AVAILABLE === "1") return { accessMode: AccessModes.CursorAgentCli, available: true };
  try {
    execFileSync("cursor-agent", ["status"], {
      stdio: "pipe",
      env: selectedProbeEnv(env),
      timeout: 10_000,
    });
    return { accessMode: AccessModes.CursorAgentCli, available: true };
  } catch (error) {
    const output = errorOutput(error);
    if (/not authenticated|unauthenticated|login required|please log in/i.test(output)) {
      return { accessMode: AccessModes.CursorAgentCli, available: false, reason: "cursor-agent is not authenticated" };
    }
    return {
      accessMode: AccessModes.CursorAgentCli,
      available: true,
      reason: "cursor-agent status probe inconclusive",
    };
  }
}

function claudeCodeAuthAvailable(binary: string, env: Record<string, string | undefined>): AccessModeAvailability {
  if (env.KIWI_FAKE_BINARY_AVAILABLE === "1") {
    return { accessMode: AccessModes.ClaudeCodeCli, available: true };
  }
  try {
    const output = execFileSync(binary, ["auth", "status"], {
      encoding: "utf-8",
      env: selectedProbeEnv(env),
      timeout: 10_000,
    });
    const parsed = JSON.parse(output) as { loggedIn?: unknown; authMethod?: unknown; apiProvider?: unknown };
    if (parsed.loggedIn === true) {
      const authMethod = typeof parsed.authMethod === "string" ? ` via ${parsed.authMethod}` : "";
      const apiProvider = typeof parsed.apiProvider === "string" ? ` (${parsed.apiProvider})` : "";
      return {
        accessMode: AccessModes.ClaudeCodeCli,
        available: true,
        reason: `authenticated${authMethod}${apiProvider}`,
      };
    }
    return { accessMode: AccessModes.ClaudeCodeCli, available: false, reason: "claude is not logged in" };
  } catch (error) {
    const output = errorOutput(error);
    if (/loggedIn["']?\s*:\s*false|not logged in|login/i.test(output)) {
      return { accessMode: AccessModes.ClaudeCodeCli, available: false, reason: "claude is not logged in" };
    }
    return {
      accessMode: AccessModes.ClaudeCodeCli,
      available: false,
      reason: "claude auth status probe failed",
    };
  }
}

export function evaluateAccessModeAvailability(
  accessMode: AccessMode,
  env: Record<string, string | undefined>,
): AccessModeAvailability {
  if (accessMode === AccessModes.Stub) return { accessMode, available: true };
  if (accessMode === AccessModes.Local) {
    return env.KIWI_LOCAL_MODEL_ENDPOINT
      ? { accessMode, available: true }
      : { accessMode, available: false, reason: "KIWI_LOCAL_MODEL_ENDPOINT not set" };
  }
  const apiKey = ENV_KEY_FOR_API[accessMode];
  if (apiKey) {
    return env[apiKey]
      ? { accessMode, available: true }
      : { accessMode, available: false, reason: `${apiKey} not set` };
  }
  const binary = RECOGNIZED_BINARIES[accessMode];
  if (binary) {
    const customBinary = accessMode === AccessModes.ClaudeCodeCli ? env.KIWI_CLAUDE_CODE_BINARY : undefined;
    const candidate = customBinary ?? binary;
    if (!which(candidate, env)) {
      return { accessMode, available: false, reason: `binary '${candidate}' not on PATH` };
    }
    if (accessMode === AccessModes.ClaudeCodeCli) return claudeCodeAuthAvailable(candidate, env);
    if (accessMode === AccessModes.CursorAgentCli) return cursorAgentAuthAvailable(env);
    return { accessMode, available: true };
  }
  return { accessMode, available: false, reason: "access mode not recognized as locally available" };
}

const DEFAULT_PRIORITY: AccessMode[] = [
  AccessModes.ClaudeCodeCli,
  AccessModes.CodexCli,
  AccessModes.CursorAgentCli,
  AccessModes.AnthropicApi,
  AccessModes.OpenaiApi,
  AccessModes.Cursor,
  AccessModes.Jetbrains,
  AccessModes.Local,
  AccessModes.Stub,
];

export function preferredAccessModes(env: Record<string, string | undefined>): AccessMode[] {
  const forced = env.KIWI_FORCE_ACCESS_MODE;
  if (forced && DEFAULT_PRIORITY.includes(forced as AccessMode)) {
    return [forced as AccessMode];
  }
  return DEFAULT_PRIORITY;
}

export interface SelectModelByAccessModeParams {
  candidates: ModelEntry[];
  env: Record<string, string | undefined>;
  preferOrder?: AccessMode[];
  excludeStub?: boolean;
}

export interface SelectedModel {
  model: ModelEntry;
  availability: AccessModeAvailability;
}

export function selectEnabledModelByAccessMode(params: SelectModelByAccessModeParams): SelectedModel | null {
  const order = params.preferOrder ?? preferredAccessModes(params.env);
  const enabled = params.candidates.filter((entry) => entry.enabled);
  const filtered = params.excludeStub ? enabled.filter((entry) => entry.accessMode !== AccessModes.Stub) : enabled;
  for (const accessMode of order) {
    const matches = filtered.filter((entry) => entry.accessMode === accessMode);
    if (matches.length === 0) continue;
    const availability = evaluateAccessModeAvailability(accessMode, params.env);
    if (!availability.available) continue;
    const model = matches[0];
    if (!model) continue;
    return { model, availability };
  }
  if (!params.excludeStub) {
    const stub = enabled.find((entry) => entry.accessMode === AccessModes.Stub);
    if (stub) return { model: stub, availability: { accessMode: AccessModes.Stub, available: true } };
  }
  return null;
}
