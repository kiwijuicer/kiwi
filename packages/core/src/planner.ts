import {
  AgentRole,
  BudgetProfile,
  Initiative,
  InitiativeSource,
  ModelCapability,
  RiskProfile,
  Step,
  StepType,
  TaskGraph,
  TaskGraphSchema,
  KiwiPolicy,
} from "@ai-kiwi/contracts";
import {
  generateInitiativeId,
  generatePlanId,
  generateStepId,
} from "./ids";

interface RoutingChoice {
  agentRole: AgentRole;
  modelCapability: ModelCapability;
}

const DEFAULT_SEQUENCE: string[] = [
  "Discover relevant context",
  "Create implementation plan",
  "Add or update failing tests",
  "Implement scoped change",
  "Run validation and review",
];

function extractTitle(rawInput: string): string {
  const headingMatch = rawInput.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].trim();

  const firstLine = rawInput.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) return "Untitled initiative";
  return firstLine.trim().slice(0, 120);
}

function extractStepTitles(rawInput: string): string[] {
  const matches = Array.from(rawInput.matchAll(/^##\s+(.+)$/gm))
    .map((entry) => entry[1]?.trim())
    .filter((entry): entry is string => Boolean(entry && entry.length > 0));

  return matches.length > 0 ? matches : DEFAULT_SEQUENCE;
}

function extractAcceptanceCriteria(rawInput: string): string[] {
  const lines = rawInput.split("\n");
  const criteria: string[] = [];
  let inConstraints = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^constraints?:/i.test(trimmed)) {
      inConstraints = true;
      continue;
    }

    if (inConstraints && /^[-*]\s+/.test(trimmed)) {
      criteria.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (inConstraints && trimmed.startsWith("#")) break;
  }

  if (criteria.length > 0) return criteria;

  return [
    "Existing behavior stays compatible",
    "Behavior changes are covered by tests",
    "No risky changes without required approvals",
  ];
}

function inferStepType(title: string): StepType {
  const value = title.toLowerCase();

  if (/\b(context|discover|analy[sz]e|research|inspect)\b/.test(value)) {
    return "context_discovery";
  }
  if (/\b(plan|architecture|design|decompose)\b/.test(value)) {
    return "planning";
  }
  if (/\btest|spec\b/.test(value)) {
    return "test_creation";
  }
  if (/\breview|audit\b/.test(value)) {
    return "review";
  }
  if (/\bvalidate|lint|typecheck|verify\b/.test(value)) {
    return "validation";
  }
  if (/\brule|agents\.md|policy\b/.test(value)) {
    return "rules_update";
  }
  if (/\bdocs?|documentation|readme\b/.test(value)) {
    return "documentation";
  }

  return "coding";
}

function defaultRouting(stepType: StepType): RoutingChoice {
  switch (stepType) {
    case "context_discovery":
      return { agentRole: "researcher", modelCapability: "mid" };
    case "planning":
      return { agentRole: "planner", modelCapability: "frontier" };
    case "test_creation":
      return { agentRole: "executor", modelCapability: "mid" };
    case "validation":
      return { agentRole: "reviewer", modelCapability: "strong" };
    case "review":
      return { agentRole: "reviewer", modelCapability: "frontier" };
    case "rules_update":
      return { agentRole: "rules", modelCapability: "mid" };
    case "documentation":
      return { agentRole: "executor", modelCapability: "cheap" };
    case "coding":
    default:
      return { agentRole: "executor", modelCapability: "strong" };
  }
}

function routedByPolicy(stepType: StepType, policy: KiwiPolicy): RoutingChoice {
  const override = policy.routing.stepTypeOverrides[stepType];
  if (override) {
    return {
      agentRole: override.agentRole,
      modelCapability: override.modelCapability,
    };
  }

  return defaultRouting(stepType);
}

function stepSuccessCriteria(stepType: StepType): string[] {
  switch (stepType) {
    case "context_discovery":
      return [
        "Relevant files and constraints are identified",
        "Open questions are captured",
      ];
    case "planning":
      return [
        "Plan is split into executable steps",
        "Risk and rollback considerations are explicit",
      ];
    case "test_creation":
      return [
        "Tests encode expected behavior",
        "Behavior changes are detectable by test suite",
      ];
    case "coding":
      return [
        "Change is scoped to required behavior",
        "No unrelated modifications are introduced",
      ];
    case "validation":
      return ["Typecheck, lint, and relevant tests are green"];
    case "review":
      return ["Structured review verdict is produced"];
    case "rules_update":
      return ["Rule files are consistent with project vision"];
    case "documentation":
      return ["Documentation reflects implemented behavior"];
    default:
      return ["Step is completed"];
  }
}

function requiredGates(stepType: StepType): string[] {
  switch (stepType) {
    case "coding":
    case "test_creation":
    case "validation":
      return ["typecheck", "lint", "tests"];
    case "review":
      return ["structured_review_json"];
    default:
      return [];
  }
}

function scoreRisk(rawInput: string): number {
  const text = rawInput.toLowerCase();
  let score = 2;

  if (/\bauth|payment|migration|infra|secrets?|ci\/cd|workflow\b/.test(text)) {
    score += 2;
  }
  if (/\bproduction|critical|security\b/.test(text)) {
    score += 1;
  }

  return Math.max(1, Math.min(5, score));
}

function scoreComplexity(stepCount: number, rawInput: string): number {
  let score = stepCount >= 6 ? 4 : 3;
  if (rawInput.length < 300) score -= 1;
  if (rawInput.length > 2000) score += 1;
  return Math.max(1, Math.min(5, score));
}

export function createInitiativeFromInput(params: {
  rawInput: string;
  repoPath: string;
  source: InitiativeSource;
  riskProfile?: RiskProfile;
  budgetProfile?: BudgetProfile;
  now?: Date;
  idSuffix?: string;
}): Initiative {
  const now = params.now ?? new Date();
  const idOptions = params.idSuffix ? { suffix: params.idSuffix } : {};
  return {
    id: generateInitiativeId(now, idOptions),
    title: extractTitle(params.rawInput),
    rawInput: params.rawInput,
    source: params.source,
    repoPath: params.repoPath,
    riskProfile: params.riskProfile ?? "dev",
    budgetProfile: params.budgetProfile ?? "normal",
    createdAt: now.toISOString(),
  };
}

export function buildDeterministicTaskGraph(params: {
  runId: string;
  initiative: Initiative;
  policy: KiwiPolicy;
  now?: Date;
  planIdSuffix?: string;
}): TaskGraph {
  const now = params.now ?? new Date();
  const idOptions = params.planIdSuffix ? { suffix: params.planIdSuffix } : {};
  const stepTitles = extractStepTitles(params.initiative.rawInput);

  const steps: Step[] = stepTitles.map((title, index) => {
    const type = inferStepType(title);
    const route = routedByPolicy(type, params.policy);

    return {
      stepId: generateStepId(index),
      type,
      title,
      dependsOn: index === 0 ? [] : [generateStepId(index - 1)],
      successCriteria: stepSuccessCriteria(type),
      requiredGates: requiredGates(type),
      recommendedAgentRole: route.agentRole,
      recommendedModelCapability: route.modelCapability,
      status: "pending",
    };
  });

  const graph: TaskGraph = {
    planId: generatePlanId(now, idOptions),
    runId: params.runId,
    initiativeId: params.initiative.id,
    summary: `Deterministic plan for "${params.initiative.title}"`,
    steps,
    acceptanceCriteria: extractAcceptanceCriteria(params.initiative.rawInput),
    assumptions: [],
    openQuestions: [],
    riskScore: scoreRisk(params.initiative.rawInput),
    complexityScore: scoreComplexity(steps.length, params.initiative.rawInput),
    createdAt: now.toISOString(),
  };

  return TaskGraphSchema.parse(graph);
}
