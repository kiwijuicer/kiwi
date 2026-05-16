import {
  ContractValues,
  AgentRole,
  BudgetProfile,
  Initiative,
  InitiativeSource,
  ModelCapability,
  RiskProfile,
  SubPlan,
  Step,
  StepType,
  TaskGraph,
  TaskGraphSchema,
  KiwiPolicy,
} from "@kiwi/contracts";
import { generateInitiativeId, generatePlanId, generateStepId } from "./ids";

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

  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }

  const firstLine = rawInput.split("\n").find((line) => line.trim().length > 0);

  if (!firstLine) {
    return "Untitled initiative";
  }

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

    if (inConstraints && trimmed.startsWith("#")) {
      break;
    }
  }

  if (criteria.length > 0) {
    return criteria;
  }

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
  if (/\b(pull request|merge request)\b|\bpr\b/.test(value)) {
    return "scm_pull_request";
  }
  if (/\b(ticket|issue)\b/.test(value)) {
    return "scm_ticket";
  }
  if (/\b(publish|post|submit)\b.*\b(review|comment|finding)s?\b/.test(value)) {
    return "scm_review";
  }
  if (/\brule|agents\.md|policy\b/.test(value)) {
    return "rules_update";
  }
  if (/\bdocs?|documentation|readme\b/.test(value)) {
    return "documentation";
  }
  if (/\brefactor|restructure|rename|extract\b/.test(value)) {
    return "refactoring";
  }
  if (/\b(create|add|scaffold|new)\b.*\b(code|feature|component|module|endpoint|command)\b/.test(value)) {
    return "code_creation";
  }
  if (/\b(change|modify|update|implement|fix)\b/.test(value)) {
    return "code_modification";
  }
  if (/\b(validat(?:e|ion)|lint|typecheck|verify)\b/.test(value)) {
    return "validation";
  }
  if (/\breview|audit\b/.test(value)) {
    return "review";
  }

  return "coding";
}

function isCodeExecutionStep(stepType: StepType): boolean {
  return ["coding", "code_creation", "code_modification", "refactoring"].includes(stepType);
}

function defaultRouting(stepType: StepType): RoutingChoice {
  switch (stepType) {
    case "context_discovery":
      return { agentRole: ContractValues.Researcher, modelCapability: ContractValues.Mid };
    case "planning":
      return { agentRole: ContractValues.Planner, modelCapability: ContractValues.Frontier };
    case "test_creation":
      return { agentRole: ContractValues.Executor, modelCapability: ContractValues.Mid };
    case "validation":
      return { agentRole: ContractValues.Reviewer, modelCapability: ContractValues.Strong };
    case "review":
      return { agentRole: ContractValues.Reviewer, modelCapability: ContractValues.Frontier };
    case "scm_ticket":
    case "scm_pull_request":
    case "scm_review":
      return { agentRole: ContractValues.Executor, modelCapability: ContractValues.Mid };
    case "rules_update":
      return { agentRole: ContractValues.Rules, modelCapability: ContractValues.Mid };
    case "documentation":
      return { agentRole: ContractValues.Executor, modelCapability: ContractValues.Cheap };
    case "code_creation":
    case "code_modification":
    case "refactoring":
    case "coding":
    default:
      return { agentRole: ContractValues.Executor, modelCapability: ContractValues.Strong };
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
      return ["Relevant files and constraints are identified", "Open questions are captured"];
    case "planning":
      return ["Plan is split into executable steps", "Risk and rollback considerations are explicit"];
    case "test_creation":
      return ["Tests encode expected behavior", "Behavior changes are detectable by test suite"];
    case "code_creation":
      return ["New code is scoped to the requested feature", "No unrelated modifications are introduced"];
    case "code_modification":
      return [
        "Change is scoped to required behavior",
        "Existing behavior stays compatible unless intentionally changed",
      ];
    case "refactoring":
      return ["External behavior stays unchanged", "Refactor reduces complexity or improves local structure"];
    case "coding":
      return ["Change is scoped to required behavior", "No unrelated modifications are introduced"];
    case "validation":
      return ["Typecheck, lint, and relevant tests are green"];
    case "review":
      return ["Structured review verdict is produced"];
    case "scm_ticket":
      return ["Ticket draft or remote ticket result is recorded without storing credentials"];
    case "scm_pull_request":
      return ["Pull request draft or remote pull request result is recorded without storing credentials"];
    case "scm_review":
      return ["Review draft or remote review result is recorded without storing credentials"];
    case "rules_update":
      return ["Rule files are consistent with project vision"];
    case "documentation":
      return ["Documentation reflects implemented behavior"];
    default:
      return ["Step is completed"];
  }
}

function requiredGates(stepType: StepType): string[] {
  if (isCodeExecutionStep(stepType) || stepType === "test_creation" || stepType === "validation") {
    return [ContractValues.Typecheck, ContractValues.Lint, ContractValues.Tests];
  }

  switch (stepType) {
    case "review":
      return ["structured_review_json"];
    case "context_discovery":
    case "planning":
    case "coding":
    case "code_creation":
    case "code_modification":
    case "refactoring":
    case "scm_ticket":
    case "scm_pull_request":
    case "scm_review":
    case "rules_update":
    case "documentation":
      return [];
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

  if (rawInput.length < 300) {
    score -= 1;
  }
  if (rawInput.length > 2000) {
    score += 1;
  }

  return Math.max(1, Math.min(5, score));
}

function createSubPlanId(index: number): string {
  return `subplan_${index + 1}`;
}

function resolveRootSubPlanId(params: {
  previousWasRoot: boolean;
  currentRootSubPlanId: string | null;
  subPlanCount: number;
}): string {
  if (params.previousWasRoot && params.currentRootSubPlanId) {
    return params.currentRootSubPlanId;
  }

  return createSubPlanId(params.subPlanCount);
}

function resolveDependentSubPlanId(params: {
  step: Step;
  stepToSubPlan: Map<string, string>;
  subPlanCount: number;
}): string {
  const firstDependency = params.step.dependsOn[0];

  if (firstDependency) {
    const existing = params.stepToSubPlan.get(firstDependency);

    if (existing) {
      return existing;
    }
  }

  return createSubPlanId(params.subPlanCount);
}

function ensureSubPlan(params: {
  subPlans: SubPlan[];
  byId: Map<string, SubPlan>;
  subPlanId: string;
  title: string;
}): SubPlan {
  const existing = params.byId.get(params.subPlanId);

  if (existing) {
    return existing;
  }
  const created: SubPlan = {
    subPlanId: params.subPlanId,
    title: params.title,
    stepIds: [],
    dependsOn: [],
    maxConcurrency: 1,
  };
  params.subPlans.push(created);
  params.byId.set(created.subPlanId, created);

  return created;
}

function addStepToSubPlan(params: {
  step: Step;
  subPlanId: string;
  subPlans: SubPlan[];
  subPlansById: Map<string, SubPlan>;
  stepToSubPlan: Map<string, string>;
}): void {
  const targetSubPlan = ensureSubPlan({
    subPlans: params.subPlans,
    byId: params.subPlansById,
    subPlanId: params.subPlanId,
    title: `Subplan ${params.subPlans.length + 1}: ${params.step.title}`,
  });
  targetSubPlan.stepIds.push(params.step.stepId);
  params.stepToSubPlan.set(params.step.stepId, targetSubPlan.subPlanId);
}

function assignSubPlanDependencies(params: {
  subPlans: SubPlan[];
  stepsById: Map<string, Step>;
  stepToSubPlan: Map<string, string>;
}): void {
  for (const subPlan of params.subPlans) {
    const dependsOn = new Set<string>();

    for (const stepId of subPlan.stepIds) {
      const step = params.stepsById.get(stepId);

      if (!step) {
        continue;
      }
      for (const dependencyStepId of step.dependsOn) {
        const dependencySubPlanId = params.stepToSubPlan.get(dependencyStepId);

        if (!dependencySubPlanId || dependencySubPlanId === subPlan.subPlanId) {
          continue;
        }
        dependsOn.add(dependencySubPlanId);
      }
    }
    subPlan.dependsOn = Array.from(dependsOn).sort();
  }
}

export function deriveSubPlansFromSteps(steps: Step[]): SubPlan[] {
  const subPlans: SubPlan[] = [];
  const subPlansById = new Map<string, SubPlan>();
  const stepToSubPlan = new Map<string, string>();
  const stepsById = new Map(steps.map((step) => [step.stepId, step]));
  let previousWasRoot = false;
  let currentRootSubPlanId: string | null = null;

  for (const step of steps) {
    const rootStep = step.dependsOn.length === 0;
    const subPlanId: string = rootStep
      ? resolveRootSubPlanId({
          previousWasRoot,
          currentRootSubPlanId,
          subPlanCount: subPlans.length,
        })
      : resolveDependentSubPlanId({
          step,
          stepToSubPlan,
          subPlanCount: subPlans.length,
        });

    addStepToSubPlan({
      step,
      subPlanId,
      subPlans,
      subPlansById,
      stepToSubPlan,
    });

    if (rootStep) {
      previousWasRoot = true;
      currentRootSubPlanId = subPlanId;
    } else {
      previousWasRoot = false;
      currentRootSubPlanId = null;
    }
  }

  assignSubPlanDependencies({ subPlans, stepsById, stepToSubPlan });

  return subPlans;
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
      status: ContractValues.Pending,
    };
  });
  const subPlans = deriveSubPlansFromSteps(steps);

  const graph: TaskGraph = {
    planId: generatePlanId(now, idOptions),
    runId: params.runId,
    initiativeId: params.initiative.id,
    summary: `Deterministic plan for "${params.initiative.title}"`,
    steps,
    subPlans,
    acceptanceCriteria: extractAcceptanceCriteria(params.initiative.rawInput),
    assumptions: [],
    openQuestions: [],
    riskScore: scoreRisk(params.initiative.rawInput),
    complexityScore: scoreComplexity(steps.length, params.initiative.rawInput),
    createdAt: now.toISOString(),
  };

  return TaskGraphSchema.parse(graph);
}
