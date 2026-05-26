import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "./preflight.ts";

export const sandboxModes = ["enabled", "disabled"] as const;
export type SandboxMode = (typeof sandboxModes)[number];

export const agentModes = ["agent", "plan", "ask"] as const;
export type AgentMode = (typeof agentModes)[number];

const homeDir = process.env.CURSOR_AGENT_HOME ?? join(homedir(), ".cursor-agent-orchestrator");
const cursorPluginDir =
  process.env.CURSOR_AGENT_BROWSER_HARNESS_PLUGIN ??
  join(homedir(), ".cursor", "plugins", "local", "browser-harness");

export const config = {
  homeDir,
  jobsDir: join(homeDir, "jobs"),
  trashDir: join(homeDir, "trash"),
  defaultModel: process.env.CURSOR_AGENT_MODEL ?? "composer-2.5-fast",
  defaultSandbox: (process.env.CURSOR_AGENT_SANDBOX ?? "enabled") as SandboxMode,
  defaultMode: (process.env.CURSOR_AGENT_MODE ?? "agent") as AgentMode,
  defaultTimeoutMinutes: Number(process.env.CURSOR_AGENT_TIMEOUT_MINUTES ?? "45"),
  jobsListLimit: Number(process.env.CURSOR_AGENT_JOBS_LIMIT ?? "20"),
  tmuxPrefix: process.env.CURSOR_AGENT_TMUX_PREFIX ?? "cursor-agent",
  agentPath: resolveExecutable(process.env.CURSOR_AGENT_AGENT_PATH ?? "agent"),
  allowBrowserHarnessSandbox: process.env.CURSOR_AGENT_ALLOW_BROWSER_HARNESS_SANDBOX === "1",
  browserHarnessSkillPath:
    process.env.CURSOR_AGENT_BROWSER_HARNESS_SKILL ??
    join(homedir(), ".codex", "skills", "browser-harness", "SKILL.md"),
  browserHarnessCanonicalSkillPath:
    process.env.CURSOR_AGENT_BROWSER_HARNESS_CANONICAL_SKILL ??
    join(homedir(), "dev", "browser-harness", "SKILL.md"),
  browserHarnessHelpersPath:
    process.env.CURSOR_AGENT_BROWSER_HARNESS_HELPERS ??
    join(homedir(), "dev", "browser-harness", "helpers.py"),
  browserHarnessPluginDir: cursorPluginDir
};

export function isSandboxMode(value: string): value is SandboxMode {
  return (sandboxModes as readonly string[]).includes(value);
}

export function isAgentMode(value: string): value is AgentMode {
  return (agentModes as readonly string[]).includes(value);
}
