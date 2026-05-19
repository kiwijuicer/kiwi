import type { McpToolErrorCategory } from "../constants.js";
import type { McpRecovery } from "../ux/index.js";

interface ToolActionRequiredErrorData {
  category: McpToolErrorCategory;
  recovery: McpRecovery;
}

export class ToolActionRequiredError extends Error {
  readonly code = -32010 as const;
  readonly data: ToolActionRequiredErrorData;

  constructor(message: string, data: ToolActionRequiredErrorData) {
    super(message);
    this.name = "ToolActionRequiredError";
    this.data = data;
  }
}
