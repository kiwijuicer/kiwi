export const McpTransportNames = {
  Stdio: "stdio",
  Http: "http",
  StreamableHttp: "streamable-http",
} as const;

export const MCP_TRANSPORT_NAME_VALUES = [
  McpTransportNames.Stdio,
  McpTransportNames.Http,
  McpTransportNames.StreamableHttp,
] as const;

export type McpTransportName = (typeof McpTransportNames)[keyof typeof McpTransportNames];

export const McpToolProgressStatuses = {
  Started: "started",
  Selected: "selected",
} as const;

export const McpToolErrorCategories = {
  ActionRequired: "action_required",
  Blocked: ContractValues.Blocked,
  StalePreview: "stale_preview",
} as const;

export type McpToolErrorCategory = (typeof McpToolErrorCategories)[keyof typeof McpToolErrorCategories];

export const McpMutationScopes = {
  ReadOnly: "READ_ONLY",
  WritesRunArtifacts: "WRITES_RUN_ARTIFACTS",
  MutatesWorktree: "MUTATES_WORKTREE",
  AppliesPatch: "APPLIES_PATCH",
  PushesBranch: "PUSHES_BRANCH",
} as const;

export type McpMutationScope = (typeof McpMutationScopes)[keyof typeof McpMutationScopes];
import { ContractValues } from "@kiwi/contracts";
