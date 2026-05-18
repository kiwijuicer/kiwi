import type { McpToolErrorCategory } from "../constants";
import type { McpRecovery } from "../ux";

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
