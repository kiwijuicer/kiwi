export const CliProgressStatuses = {
  Started: "started",
} as const;

export type CliProgressStatus = (typeof CliProgressStatuses)[keyof typeof CliProgressStatuses];

export const McpInitTargets = {
  None: "none",
  Cursor: "cursor",
  Claude: "claude",
  Codex: "codex",
  All: "all",
} as const;

export type McpInitTarget = (typeof McpInitTargets)[keyof typeof McpInitTargets];

export const ConfigWriteStatuses = {
  Written: "written",
  Updated: "updated",
  Preserved: "preserved",
} as const;

export type ConfigWriteStatus = (typeof ConfigWriteStatuses)[keyof typeof ConfigWriteStatuses];

export const GitignoreWriteStatuses = {
  Updated: "updated",
  Preserved: "preserved",
  Missing: "missing",
} as const;

export type GitignoreWriteStatus = (typeof GitignoreWriteStatuses)[keyof typeof GitignoreWriteStatuses];

export const TicketInputSources = {
  File: "file",
  Cli: "cli",
} as const;

export type TicketInputSource = (typeof TicketInputSources)[keyof typeof TicketInputSources];
