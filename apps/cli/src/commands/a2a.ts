import { existsSync, readFileSync } from "fs";
import path from "path";
import chalk from "chalk";
import { handleA2AEnvelope } from "@ai-kiwi/core";
import { resolveCliWorkspace, CliWorkspaceOptions } from "../workspace-options";

export interface A2AReceiveOptions extends CliWorkspaceOptions {
  loopback?: boolean;
  localAgent?: string;
  trustedAgent?: string;
  now?: Date;
}

function readEnvelope(value: string, cwd: string): unknown {
  const target = path.isAbsolute(value) ? value : path.join(cwd, value);
  const raw = existsSync(target) ? readFileSync(target, "utf-8") : value;
  return JSON.parse(raw) as unknown;
}

function trustedAgents(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function runA2AReceive(
  envelopeInput: string,
  opts: A2AReceiveOptions = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const workspace = resolveCliWorkspace(opts, cwd, false);
  const result = handleA2AEnvelope({
    cwd: workspace.workspacePath,
    envelope: readEnvelope(envelopeInput, cwd),
    now: opts.now,
    policy: {
      mode: opts.loopback ? "loopback" : "disabled",
      localAgentId: opts.localAgent ?? "ai-kiwi-local",
      trustedAgentIds: trustedAgents(opts.trustedAgent),
    },
  });

  const mark = result.decision.status === "accepted" ? chalk.green("✓") : chalk.yellow("•");
  console.log(mark + " A2A envelope handled");
  console.log(chalk.dim(`status: ${result.decision.status}`));
  console.log(chalk.dim(`reason: ${result.decision.reason}`));
  if (result.decision.runId) console.log(chalk.dim(`runId: ${result.decision.runId}`));
  if (result.decision.inboxRef) console.log(chalk.dim(`inbox: .kiwi/a2a/${result.decision.inboxRef}`));
}
