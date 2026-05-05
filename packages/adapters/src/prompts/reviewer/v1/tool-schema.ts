import { REVIEW_ISSUE_SEVERITY_VALUES, REVIEW_VERDICT_VALUE_VALUES } from "@kiwi/contracts";

export const REVIEWER_TOOL_NAME = "emit_review_verdict";

interface AnthropicReviewerToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: {
    type: "ephemeral";
  };
}

export function reviewerToolDefinition(): AnthropicReviewerToolDefinition {
  return {
    name: REVIEWER_TOOL_NAME,
    description: "Emit one schema-valid kiwi ReviewVerdict for the focal step diff and gate evidence.",
    cache_control: { type: "ephemeral" },
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "safeToContinue", "issues", "recommendedNextSteps", "confidence"],
      properties: {
        verdict: {
          type: "string",
          enum: [...REVIEW_VERDICT_VALUE_VALUES],
        },
        safeToContinue: { type: "boolean" },
        issues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "title", "severity"],
            properties: {
              code: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              severity: { type: "string", enum: [...REVIEW_ISSUE_SEVERITY_VALUES] },
              detail: { type: "string", minLength: 1 },
              filePath: { type: "string", minLength: 1 },
              line: { type: "integer", minimum: 1 },
            },
          },
        },
        recommendedNextSteps: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  };
}
