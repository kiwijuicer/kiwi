import { ContractValues, CommandProfile, GateType, KiwiPolicy, StepType } from "@kiwi/contracts";

export interface CommandExecutionPolicy {
  allowedCommands: string[];
  approvalState: "auto" | "required" | "blocked";
  approvalRequiredPaths: string[];
  deniedPaths: string[];
  envAllowlist: string[];
  secretValues: string[];
  networkPolicy: "disabled" | "enabled";
  timeoutMs: number;
  maxOutputBytes: number;
}

export function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) parts.push(value.replace(/\\(["'])/g, "$1"));
  }
  return parts;
}

function defaultProfile(): CommandProfile {
  return {
    allowedCommands: ["node", "pnpm"],
    approvalState: "auto",
    approvalRequiredPaths: [],
    deniedPaths: [".env*", "secrets/**"],
    envAllowlist: ["PATH", "CI"],
    secretEnvNames: [],
    networkPolicy: "disabled",
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
    case "forbidden_file_checks":
    case "secrets_check":
    case "structured_review_json":
      return null;
    default:
      return null;
  }
}

export function noopCommand(): string[] {
  return ["node", "-e", "console.log('kiwi step attempt recorded')"];
}
