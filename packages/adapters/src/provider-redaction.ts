import { KiwiPolicy } from "@kiwi/contracts";

export const REDACTED = "[REDACTED]";

const SECRET_KEY_PATTERN =
  /((?:api[_-]?key|token|secret|password|credential|private[_-]?key)\s*[:=]\s*)(["']?)[^\s"',;]+(\2)/gi;
const SECRET_VALUE_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\b/g,
];

export interface RedactionSummary {
  secretEnvNames: string[];
  envSecretValuesRedacted: number;
  detectedPatterns: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

export function secretEnvNamesFromPolicy(policy: KiwiPolicy): string[] {
  return unique(
    Object.values(policy.commandProfiles).flatMap((profile) => profile.secretEnvNames.map((name) => name.trim())),
  );
}

function envSecretValues(secretEnvNames: string[], env: Record<string, string | undefined>): string[] {
  return unique(
    secretEnvNames
      .map((name) => env[name])
      .filter((value): value is string => typeof value === "string" && value.length >= 4),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactKnownSecrets(text: string, secrets: string[]): { text: string; count: number } {
  let redacted = text;
  let count = 0;

  for (const secret of secrets) {
    const next = redacted.replace(new RegExp(escapeRegExp(secret), "g"), () => {
      count += 1;

      return REDACTED;
    });
    redacted = next;
  }

  return { text: redacted, count };
}

function redactDetectedSecrets(text: string): { text: string; patterns: string[] } {
  let redacted = text;
  const patterns: string[] = [];
  redacted = redacted.replace(SECRET_KEY_PATTERN, (_match, prefix: string) => {
    patterns.push("key_value");

    return `${prefix}${REDACTED}`;
  });

  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      patterns.push(pattern.source);

      return REDACTED;
    });
  }

  return { text: redacted, patterns: unique(patterns) };
}

function redactText(text: string, secrets: string[]): { text: string; envCount: number; patterns: string[] } {
  const known = redactKnownSecrets(text, secrets);
  const detected = redactDetectedSecrets(known.text);

  return {
    text: detected.text,
    envCount: known.count,
    patterns: detected.patterns,
  };
}

function redactUnknownValue(value: unknown, secrets: string[], summary: RedactionSummary, keyName?: string): unknown {
  if (typeof value === "string") {
    if (keyName === "secretEnvNames") {
      return REDACTED;
    }
    const redacted = redactText(value, secrets);
    summary.envSecretValuesRedacted += redacted.envCount;
    summary.detectedPatterns = unique([...summary.detectedPatterns, ...redacted.patterns]);

    return redacted.text;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknownValue(entry, secrets, summary, keyName));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactUnknownValue(entry, secrets, summary, key);
  }

  return output;
}

export function redactForProvider<T>(
  value: T,
  policy: KiwiPolicy,
  env: Record<string, string | undefined>,
): {
  redacted: T;
  summary: RedactionSummary;
} {
  const secretEnvNames = secretEnvNamesFromPolicy(policy);
  const secrets = envSecretValues(secretEnvNames, env);
  const summary: RedactionSummary = {
    secretEnvNames,
    envSecretValuesRedacted: 0,
    detectedPatterns: [],
  };

  return {
    redacted: redactUnknownValue(value, secrets, summary) as T,
    summary,
  };
}
