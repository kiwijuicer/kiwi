import {
  AGENT_ROLE_VALUES,
  GATE_TYPE_VALUES,
  MODEL_CAPABILITY_VALUES,
  STEP_STATUS_VALUES,
  STEP_TYPE_VALUES,
} from "@kiwi/contracts";

export const PLANNER_TOOL_NAME = "emit_task_graph";

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: {
    type: "ephemeral";
  };
}

const stringArraySchema = {
  type: "array",
  items: { type: "string", minLength: 1 },
};

export function plannerToolDefinition(): AnthropicToolDefinition {
  return {
    name: PLANNER_TOOL_NAME,
    description: "Emit one schema-valid kiwi TaskGraph for the requested Initiative.",
    cache_control: { type: "ephemeral" },
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "planId",
        "runId",
        "initiativeId",
        "summary",
        "steps",
        "acceptanceCriteria",
        "assumptions",
        "openQuestions",
        "riskScore",
        "complexityScore",
        "createdAt",
      ],
      properties: {
        planId: { type: "string", pattern: "^plan_[a-z0-9_]+$" },
        runId: { type: "string", pattern: "^run_[a-z0-9_]+$" },
        initiativeId: { type: "string", pattern: "^init_[a-z0-9_]+$" },
        summary: { type: "string", minLength: 1 },
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "stepId",
              "type",
              "title",
              "dependsOn",
              "successCriteria",
              "requiredGates",
              "recommendedAgentRole",
              "recommendedModelCapability",
              "status",
            ],
            properties: {
              stepId: { type: "string", pattern: "^step_\\d{3}$" },
              type: { type: "string", enum: [...STEP_TYPE_VALUES] },
              title: { type: "string", minLength: 1 },
              dependsOn: { type: "array", items: { type: "string" } },
              successCriteria: stringArraySchema,
              requiredGates: { type: "array", items: { type: "string", enum: [...GATE_TYPE_VALUES] } },
              recommendedAgentRole: { type: "string", enum: [...AGENT_ROLE_VALUES] },
              recommendedModelCapability: { type: "string", enum: [...MODEL_CAPABILITY_VALUES] },
              status: { type: "string", enum: [...STEP_STATUS_VALUES] },
            },
          },
        },
        subPlans: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["subPlanId", "title", "stepIds", "dependsOn", "maxConcurrency"],
            properties: {
              subPlanId: { type: "string", pattern: "^subplan_[a-z0-9_]+$" },
              title: { type: "string", minLength: 1 },
              stepIds: { type: "array", minItems: 1, items: { type: "string", pattern: "^step_\\d{3}$" } },
              dependsOn: { type: "array", items: { type: "string", pattern: "^subplan_[a-z0-9_]+$" } },
              maxConcurrency: { type: "integer", minimum: 1 },
            },
          },
        },
        acceptanceCriteria: stringArraySchema,
        assumptions: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } },
        riskScore: { type: "integer", minimum: 1, maximum: 5 },
        complexityScore: { type: "integer", minimum: 1, maximum: 5 },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  };
}
