export const McpTransportNames = {
  Stdio: "stdio",
  Http: "http",
} as const;

export type McpTransportName = (typeof McpTransportNames)[keyof typeof McpTransportNames];

export const McpToolProgressStatuses = {
  Started: "started",
  Selected: "selected",
} as const;

export type McpToolErrorCategory = "action_required" | "invalid_input" | "stale_preview";

export type McpMutationScope =
  | "READ_ONLY"
  | "WRITES_RUN_ARTIFACTS"
  | "MUTATES_WORKTREE"
  | "APPLIES_PATCH"
  | "PUSHES_BRANCH";
