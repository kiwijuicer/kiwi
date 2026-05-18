import { RunLockBusyError } from "@kiwi/core";
import { toolArguments } from "../tools/helpers";
import { callTool } from "../tools/dispatcher";
import { listTools } from "../tools/definitions";
import { listResources, listResourceTemplates, McpResourceNotFoundError, readMcpResource } from "../resources";
import { asRecord, JsonRpcRequest, JsonRpcResponse, textContent } from "./json-rpc";
import { ToolActionRequiredError } from "../tools/errors";
import { ToolInputValidationError } from "../tools/input-schemas";
import { safeReadOnlyToolCalls, toolCall } from "../ux";

export function defaultServerCwd(): string {
  return process.env.KIWI_WORKSPACE ?? process.cwd();
}

interface McpProgressNotification {
  jsonrpc: "2.0";
  method: "notifications/progress";
  params: {
    message: string;
    progress?: number;
    total?: number;
    progressToken: string | number;
  };
}

interface McpRequestContext {
  sendNotification?: (notification: McpProgressNotification) => void;
}

function progressTokenFor(request: JsonRpcRequest): string | number | undefined {
  const params = asRecord(request.params);
  const meta = asRecord(params._meta);
  const token = meta.progressToken;

  if (typeof token === "string" || typeof token === "number") {
    return token;
  }

  return undefined;
}

function progressSender(
  request: JsonRpcRequest,
  context: McpRequestContext | undefined,
): ((message: string, percent?: number) => void) | undefined {
  if (!context?.sendNotification) {
    return undefined;
  }
  const token = progressTokenFor(request);

  if (token === undefined) {
    return undefined;
  }

  return (message, percent) => {
    const params: McpProgressNotification["params"] = { message, progressToken: token };

    if (percent !== undefined) {
      params.progress = percent;
      params.total = 100;
    }
    context.sendNotification?.({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params,
    });
  };
}

function invalidRequestResponse(): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32600, message: "Invalid request" },
  };
}

function requestArgs(request: JsonRpcRequest): Record<string, unknown> {
  const params = asRecord(request.params);
  const rawArguments = params.arguments;

  return typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)
    ? (rawArguments as Record<string, unknown>)
    : {};
}

function workspacePathForRecovery(args: Record<string, unknown>, cwd: string): string {
  return typeof args.workspacePath === "string" && args.workspacePath.length > 0 ? args.workspacePath : cwd;
}

function recoveryForRequest(
  request: JsonRpcRequest,
  cwd: string,
): {
  reason: string;
  recommendedToolCall: ReturnType<typeof toolCall>;
  safeAlternatives: ReturnType<typeof safeReadOnlyToolCalls>;
  userMessage: string;
} {
  const args = requestArgs(request);
  const workspacePath = workspacePathForRecovery(args, cwd);
  const runId = typeof args.runId === "string" && args.runId.length > 0 ? args.runId : null;

  return {
    reason: "tool failed before completing its requested action",
    recommendedToolCall: runId
      ? toolCall("kiwi_next", { workspacePath, runId })
      : toolCall("kiwi_doctor", { workspacePath }),
    safeAlternatives: safeReadOnlyToolCalls({ workspacePath, runId }),
    userMessage: runId
      ? "Inspect the current run state with kiwi_next before retrying a mutating action."
      : "Inspect workspace readiness with kiwi_doctor before retrying.",
  };
}

function errorResponseFor(
  error: unknown,
  request: JsonRpcRequest,
  cwd: string,
  id: string | number | null,
): JsonRpcResponse {
  if (error instanceof ToolInputValidationError) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: error.code,
        message: "Invalid params",
        data: {
          category: "invalid_input",
          issues: error.issues,
          recovery: {
            reason: "tool arguments failed schema validation",
            recommendedToolCall: null,
            safeAlternatives: [],
            userMessage: "Fix the highlighted tool arguments and retry the same tool.",
          },
        },
      },
    };
  }
  if (error instanceof ToolActionRequiredError) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: error.code,
        message: error.message,
        data: error.data,
      },
    };
  }
  if (error instanceof RunLockBusyError) {
    const recovery = recoveryForRequest(request, cwd);

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32010,
        message: error.message,
        data: {
          category: "action_required",
          recovery: {
            ...recovery,
            reason: `run is locked by another operation: ${error.operation}`,
          },
          existing: error.existing,
        },
      },
    };
  }
  if (error instanceof McpResourceNotFoundError) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: error.code,
        message: error.message,
        data: error.data,
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
      data: {
        category: "action_required",
        recovery: recoveryForRequest(request, cwd),
      },
    },
  };
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  cwd: string = defaultServerCwd(),
  context?: McpRequestContext,
): Promise<JsonRpcResponse> {
  const id = request.id ?? null;

  try {
    if (request.method === "initialize") {
      const params = asRecord(request.params);
      const protocolVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05";

      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          serverInfo: { name: "kiwi", version: "0.1.0" },
          capabilities: { resources: {}, tools: {}, progress: {} },
        },
      };
    }
    if (request.method === "resources/list") {
      return { jsonrpc: "2.0", id, result: { resources: listResources(cwd) } };
    }
    if (request.method === "resources/templates/list") {
      return { jsonrpc: "2.0", id, result: { resourceTemplates: listResourceTemplates() } };
    }
    if (request.method === "resources/read") {
      const params = asRecord(request.params);

      return { jsonrpc: "2.0", id, result: { contents: [readMcpResource(String(params.uri), cwd)] } };
    }
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: listTools() } };
    }
    if (request.method === "tools/call") {
      const params = asRecord(request.params);
      const onProgress = progressSender(request, context);
      const result = await callTool(String(params.name), toolArguments(params), cwd, onProgress ? { onProgress } : {});

      return { jsonrpc: "2.0", id, result: textContent(result) };
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method}` } };
  } catch (error) {
    return errorResponseFor(error, request, cwd, id);
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === "object" && value !== null && typeof (value as { method?: unknown }).method === "string";
}

export async function handleMcpMessage(
  value: unknown,
  cwd: string,
  context?: McpRequestContext,
): Promise<unknown | undefined> {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return invalidRequestResponse();
    }

    const responses: JsonRpcResponse[] = [];

    for (const entry of value) {
      if (!isJsonRpcRequest(entry)) {
        responses.push(invalidRequestResponse());
        continue;
      }
      if (entry.id === undefined) {
        continue;
      }
      responses.push(await handleMcpRequest(entry, cwd, context));
    }

    return responses.length > 0 ? responses : undefined;
  }

  if (!isJsonRpcRequest(value)) {
    return invalidRequestResponse();
  }
  if (value.id === undefined) {
    return undefined;
  }

  return handleMcpRequest(value, cwd, context);
}
