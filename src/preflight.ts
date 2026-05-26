import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

export interface CursorPreflight {
  ok: boolean;
  version: CommandResult;
  auth: CommandResult;
  models?: CommandResult;
  hasModel: boolean;
  sandboxBlocked: boolean;
  message?: string;
}

export function resolveExecutable(command: string): string {
  if (isAbsolute(command) || command.includes("/")) return command;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = `${dir}/${command}`;
    if (existsSync(candidate)) return candidate;
  }
  return command;
}

export function runCommand(command: string, args: string[], timeout = 10_000): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return {
    status: result.status,
    stdout,
    stderr,
    combined: [stdout, stderr].filter(Boolean).join("\n")
  };
}

export function checkCursorAgent(agentPath: string, model: string, includeModels = true): CursorPreflight {
  const version = runCommand(agentPath, ["--version"], 5_000);
  const auth = runCommand(agentPath, ["status"], 10_000);
  const sandboxBlocked = isKeychainSandboxError(auth.combined);
  let models: CommandResult | undefined;
  let hasModel = false;
  if (!sandboxBlocked && auth.status === 0 && includeModels) {
    models = runCommand(agentPath, ["models"], 10_000);
    hasModel = models.stdout.includes(model);
  }
  const ok = version.status === 0 && auth.status === 0 && (!includeModels || hasModel);
  return {
    ok,
    version,
    auth,
    models,
    hasModel,
    sandboxBlocked,
    message: buildPreflightMessage({ version, auth, models, model, sandboxBlocked, includeModels, hasModel })
  };
}

export function isKeychainSandboxError(value: string): boolean {
  return /SecItemCopyMatching failed|-25308|errSecInteractionNotAllowed|-50/.test(value);
}

function buildPreflightMessage(input: {
  version: CommandResult;
  auth: CommandResult;
  models?: CommandResult;
  model: string;
  sandboxBlocked: boolean;
  includeModels: boolean;
  hasModel: boolean;
}): string | undefined {
  if (input.version.status !== 0) return `Cursor CLI not runnable: ${input.version.combined || "agent --version failed"}`;
  if (input.sandboxBlocked) {
    return [
      "Cursor CLI auth is blocked by the command sandbox.",
      `Raw auth error: ${input.auth.combined}`,
      "Run cursor-agent as an approved/escalated Codex command so Cursor can read Keychain auth and browser-harness can reach localhost CDP."
    ].join("\n");
  }
  if (input.auth.status !== 0) return `Cursor CLI auth failed: ${input.auth.combined || "agent status failed"}`;
  if (input.includeModels && !input.hasModel) {
    const detail = input.models?.combined ? `\n${input.models.combined.slice(0, 1200)}` : "";
    return `Cursor model ${input.model} was not found in agent models.${detail}`;
  }
  return undefined;
}
