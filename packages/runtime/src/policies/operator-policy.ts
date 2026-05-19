import {
  ApprovalStates,
  ContractValues,
  CommandProfile,
  GateType,
  GateTypes,
  KiwiPolicy,
  NetworkPolicies,
  StepType,
  type ApprovalState,
  type NetworkPolicy,
} from "@kiwi/contracts";

export interface CommandExecutionPolicy {
  allowedCommands: string[];
  approvalState: ApprovalState;
  approvalRequiredPaths: string[];
  deniedPaths: string[];
  envAllowlist: string[];
  secretValues: string[];
  networkPolicy: NetworkPolicy;
  timeoutMs: number;
  maxOutputBytes: number;
}

export function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(command)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];

    if (value) {
      parts.push(value.replace(/\\(["'])/g, "$1"));
    }
  }

  return parts;
}

function defaultProfile(): CommandProfile {
  return {
    allowedCommands: ["node", "pnpm"],
    approvalState: ApprovalStates.Auto,
    approvalRequiredPaths: [],
    deniedPaths: [".env*", "secrets/**"],
    envAllowlist: ["PATH", "CI"],
    secretEnvNames: [],
    networkPolicy: NetworkPolicies.Disabled,
    timeoutMs: 120_000,
    maxOutputBytes: 65_536,
  };
}

export function commandProfileForStep(policy: KiwiPolicy, stepType: StepType): CommandProfile {
  return (
    policy.commandProfiles[stepType] ??
    policy.commandProfiles.validation ??
    policy.commandProfiles.default ??
    defaultProfile()
  );
}

export function commandProfileToExecutionPolicy(
  profile: CommandProfile,
  env: Record<string, string | undefined> = process.env,
): CommandExecutionPolicy {
  return {
    allowedCommands: profile.allowedCommands,
    approvalState: profile.approvalState,
    approvalRequiredPaths: profile.approvalRequiredPaths,
    deniedPaths: profile.deniedPaths,
    envAllowlist: profile.envAllowlist,
    secretValues: profile.secretEnvNames
      .map((name) => env[name])
      .filter((value): value is string => Boolean(value && value.length > 0)),
    networkPolicy: profile.networkPolicy,
    timeoutMs: profile.timeoutMs,
    maxOutputBytes: profile.maxOutputBytes,
  };
}

export function commandForGate(policy: KiwiPolicy, gateType: GateType): string[] | null {
  switch (gateType) {
    case ContractValues.Typecheck:
      return splitCommandLine(policy.commands.typecheck);
    case ContractValues.Lint:
      return splitCommandLine(policy.commands.lint);
    case ContractValues.Tests:
      return splitCommandLine(policy.commands.test);
    case GateTypes.DiffRequired:
    case GateTypes.CommandPolicy:
    case GateTypes.ForbiddenFileChecks:
    case GateTypes.SecretsCheck:
    case GateTypes.StructuredReviewJson:
      return null;
  }
}

export function noopCommand(): string[] {
  return ["node", "-e", "console.log('kiwi step attempt recorded')"];
}

export class OperatorPolicyService {
  splitCommandLine(command: string): string[] {
    return splitCommandLine(command);
  }

  commandProfileForStep(policy: KiwiPolicy, stepType: StepType): CommandProfile {
    return commandProfileForStep(policy, stepType);
  }

  commandProfileToExecutionPolicy(
    profile: CommandProfile,
    env: Record<string, string | undefined> = process.env,
  ): CommandExecutionPolicy {
    return commandProfileToExecutionPolicy(profile, env);
  }

  commandForGate(policy: KiwiPolicy, gateType: GateType): string[] | null {
    return commandForGate(policy, gateType);
  }

  noopCommand(): string[] {
    return noopCommand();
  }
}
