import { renderMcpToolResult } from "../ux/render.js";

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function textContent(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
} {
  const result: { content: Array<{ type: "text"; text: string }>; structuredContent?: unknown } = {
    content: [
      {
        type: "text",
        text: renderMcpToolResult(value),
      },
    ],
  };

  if (typeof value === "object" && value !== null) {
    result.structuredContent = value;
  }

  return result;
}
