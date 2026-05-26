#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config, isAgentMode, isSandboxMode, sandboxModes, agentModes, type AgentMode, type SandboxMode } from "./config.ts";
import { estimateTokens, loadCodebaseMap } from "./files.ts";
import { buildBrowserHarnessPrelude, defaultBrowserHarnessPluginDirs } from "./browser-harness.ts";
import { checkCursorAgent, runCommand } from "./preflight.ts";
import {
  cleanupOldJobs,
  deleteJob,
  getAttachCommand,
  getJobFullOutput,
  getJobOutput,
  getJobsJson,
  getTurnSignal,
  killJob,
  listJobs,
  refreshJobStatus,
  sendToJob,
  startJob,
  type Job,
  type StartJobOptions
} from "./jobs.ts";
import { cleanTerminalOutput } from "./output-cleaner.ts";
import { isTmuxAvailable, listSessions } from "./tmux.ts";

interface Options {
  model: string;
  mode: AgentMode;
  sandbox: SandboxMode;
  sandboxExplicit: boolean;
  cwd: string;
  includeMap: boolean;
  dryRun: boolean;
  wait: boolean;
  clean: boolean;
  json: boolean;
  all: boolean;
  limit: number | null;
  force: boolean;
  trust: boolean;
  approveMcps: boolean;
  browserHarness: boolean;
  pluginDirs: string[];
}

const HELP = `Cursor Agent - tmux-backed Cursor Composer agents

Usage:
  cursor-agent start "prompt" [options]
  cursor-agent status <jobId>
  cursor-agent await-turn <jobId>
  cursor-agent send <jobId> "message"
  cursor-agent capture <jobId> [lines] [--clean]
  cursor-agent output <jobId> [--clean]
  cursor-agent jobs [--json] [--all]
  cursor-agent sessions
  cursor-agent attach <jobId>
  cursor-agent watch <jobId>
  cursor-agent kill <jobId>
  cursor-agent clean
  cursor-agent health

Defaults:
  model: ${config.defaultModel}
  mode: ${config.defaultMode}
  sandbox: ${config.defaultSandbox} (browser-harness QA auto-uses disabled)
  browser-harness: enabled

Options:
  -m, --model <model>          Cursor model id
  --mode <mode>                ${agentModes.join(", ")}
  --plan                       Shortcut for --mode plan
  --ask                        Shortcut for --mode ask
  --sandbox <mode>             ${sandboxModes.join(", ")}
  --force, --yolo              Force-allow Cursor tool calls
  --no-trust                   Do not pass --trust
  --approve-mcps               Pass --approve-mcps
  -d, --dir <path>             Working directory
  --map                        Inject docs/CODEBASE_MAP.md when present
  --plugin-dir <path>          Repeatable Cursor --plugin-dir
  --no-browser-harness         Disable default browser-harness skill/plugin injection
  --wait                       Wait for the first turn signal
  --dry-run                    Print launch summary only
  --clean, --strip-ansi        Clean captured terminal output
  --json                       JSON output for jobs
  --all                        Include all jobs
  --limit <n>                  Limit jobs shown
`;

function parseArgs(args: string[]): { command: string; positional: string[]; options: Options } {
  const options: Options = {
    model: config.defaultModel,
    mode: config.defaultMode,
    sandbox: config.defaultSandbox,
    sandboxExplicit: false,
    cwd: process.cwd(),
    includeMap: false,
    dryRun: false,
    wait: false,
    clean: false,
    json: false,
    all: false,
    limit: config.jobsListLimit,
    force: false,
    trust: true,
    approveMcps: false,
    browserHarness: true,
    pluginDirs: []
  };
  const positional: string[] = [];
  let command = "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const next = () => args[++i] ?? "";
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "-m" || arg === "--model") {
      options.model = next();
    } else if (arg === "--mode") {
      const mode = next();
      if (!isAgentMode(mode)) fail(`invalid mode: ${mode}`);
      options.mode = mode;
    } else if (arg === "--plan") {
      options.mode = "plan";
    } else if (arg === "--ask") {
      options.mode = "ask";
    } else if (arg === "--sandbox") {
      const mode = next();
      if (!isSandboxMode(mode)) fail(`invalid sandbox: ${mode}`);
      options.sandbox = mode;
      options.sandboxExplicit = true;
    } else if (arg === "--force" || arg === "--yolo" || arg === "-f") {
      options.force = true;
    } else if (arg === "--no-trust") {
      options.trust = false;
    } else if (arg === "--approve-mcps") {
      options.approveMcps = true;
    } else if (arg === "-d" || arg === "--dir") {
      options.cwd = next();
    } else if (arg === "--map") {
      options.includeMap = true;
    } else if (arg === "--plugin-dir") {
      options.pluginDirs.push(next());
    } else if (arg === "--no-browser-harness") {
      options.browserHarness = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--wait" || arg === "-w") {
      options.wait = true;
    } else if (arg === "--clean" || arg === "--strip-ansi") {
      options.clean = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--limit") {
      options.limit = Number(next());
    } else if (arg.startsWith("-")) {
      fail(`unknown option: ${arg}`);
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, options };
}

async function main() {
  const { command, positional, options } = parseArgs(Bun.argv.slice(2));
  if (!command) {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case "start":
      return await startCommand(positional, options);
    case "status":
      return statusCommand(positional);
    case "await-turn":
      return await awaitTurnCommand(positional);
    case "send":
      return sendCommand(positional);
    case "capture":
      return captureCommand(positional, options);
    case "output":
      return outputCommand(positional, options);
    case "jobs":
      return jobsCommand(options);
    case "sessions":
      return sessionsCommand();
    case "attach":
      return attachCommand(positional);
    case "watch":
      return await watchCommand(positional, options);
    case "kill":
      return controlCommand(positional, killJob, "Killed");
    case "delete":
      return controlCommand(positional, deleteJob, "Archived");
    case "clean":
      return cleanCommand();
    case "health":
      return healthCommand();
    default:
      return await startCommand([command, ...positional], options);
  }
}

async function startCommand(positional: string[], options: Options): Promise<number> {
  if (positional.length === 0) fail("no prompt provided");
  if (!isTmuxAvailable()) fail("tmux is required but was not found");
  normalizeBrowserHarnessSandbox(options);
  let prompt = positional.join(" ");
  if (options.includeMap) {
    const map = loadCodebaseMap(options.cwd);
    if (map) prompt = `## Codebase Map\n\n${map}\n\n---\n\n${prompt}`;
  }
  const pluginDirs = [...options.pluginDirs];
  if (options.browserHarness) {
    prompt = `${buildBrowserHarnessPrelude()}\n\n---\n\n${prompt}`;
    pluginDirs.unshift(...defaultBrowserHarnessPluginDirs());
  }
  const uniquePluginDirs = [...new Set(pluginDirs)];
  if (options.dryRun) {
    console.log(`Would send approximately ${estimateTokens(prompt).toLocaleString()} tokens`);
    console.log(`Model: ${options.model}`);
    console.log(`Mode: ${options.mode}`);
    console.log(`Sandbox: ${options.sandbox}`);
    console.log(`Force: ${options.force ? "yes" : "no"}`);
    console.log(`Browser harness: ${options.browserHarness ? "yes" : "no"}`);
    console.log(`Plugin dirs: ${uniquePluginDirs.join(", ") || "none"}`);
    console.log(`Working dir: ${options.cwd}`);
    console.log("\n--- Prompt Preview ---\n");
    console.log(prompt.slice(0, 5000));
    return 0;
  }
  preflightStart(options);
  const startOptions: StartJobOptions = {
    prompt,
    cwd: options.cwd,
    model: options.model,
    mode: options.mode,
    sandbox: options.sandbox,
    force: options.force,
    trust: options.trust,
    approveMcps: options.approveMcps,
    browserHarness: options.browserHarness,
    pluginDirs: uniquePluginDirs
  };
  const job = startJob(startOptions);
  console.log(`Job started: ${job.id}`);
  console.log(`Model: ${job.model}`);
  console.log(`Mode: ${job.mode}`);
  console.log(`Sandbox: ${job.sandbox}`);
  console.log(`Force: ${job.force ? "yes" : "no"}`);
  console.log(`Browser harness: ${job.browserHarness ? "yes" : "no"}`);
  console.log(`Working dir: ${job.cwd}`);
  console.log(`tmux session: ${job.tmuxSession}`);
  console.log(`Capture: cursor-agent capture ${job.id} --clean`);
  console.log(`Await: cursor-agent await-turn ${job.id}`);
  console.log(`Send: cursor-agent send ${job.id} "message"`);
  if (options.wait) return await awaitTurnCommand([job.id]);
  return job.status === "running" ? 0 : 1;
}

function statusCommand(positional: string[]): number {
  const id = requiredJobId(positional);
  const job = refreshJobStatus(id);
  if (!job) fail(`job not found: ${id}`);
  console.log(`Job: ${job.id}`);
  console.log(`Status: ${job.status}`);
  console.log(`Model: ${job.model}`);
  console.log(`Mode: ${job.mode}`);
  console.log(`Sandbox: ${job.sandbox}`);
  console.log(`Force: ${job.force ? "yes" : "no"}`);
  console.log(`Browser harness: ${job.browserHarness ? "yes" : "no"}`);
  console.log(`Cwd: ${job.cwd}`);
  if (job.cursorSessionId) console.log(`Cursor session: ${job.cursorSessionId}`);
  if (job.tmuxSession) console.log(`tmux session: ${job.tmuxSession}`);
  if (job.turnState) console.log(`Turn state: ${job.turnState}`);
  console.log(`Turns completed: ${job.turnCount ?? 0}`);
  if (job.lastTurnCompletedAt) console.log(`Last turn: ${job.lastTurnCompletedAt}`);
  if (job.lastAgentMessage) console.log(`Last message: ${job.lastAgentMessage}`);
  if (job.usage) console.log(`Usage: ${JSON.stringify(job.usage)}`);
  if (job.error) console.log(`Error: ${job.error}`);
  return 0;
}

async function awaitTurnCommand(positional: string[]): Promise<number> {
  const id = requiredJobId(positional);
  const started = Date.now();
  while (Date.now() - started < 12 * 60 * 60_000) {
    const signal = getTurnSignal(id);
    if (signal) {
      console.log(signal.lastAgentMessage ?? "Turn complete");
      return signal.event === "Stop" ? 0 : 1;
    }
    const job = refreshJobStatus(id);
    if (!job) fail(`job not found: ${id}`);
    if (job.status !== "running" && job.status !== "pending") {
      console.log(`Job ended: ${job.status}`);
      return job.status === "completed" ? 0 : 1;
    }
    await Bun.sleep(500);
  }
  fail("timed out waiting for turn");
}

function sendCommand(positional: string[]): number {
  const id = requiredJobId(positional);
  const message = positional.slice(1).join(" ");
  if (!message) fail("message is required");
  if (!sendToJob(id, message)) fail(`could not send to job ${id}; wait for the current turn to complete first`);
  console.log(`Started follow-up turn for ${id}: ${message}`);
  return 0;
}

function captureCommand(positional: string[], options: Options): number {
  const id = requiredJobId(positional);
  const lines = positional[1] ? Number(positional[1]) : 80;
  const output = getJobOutput(id, Number.isFinite(lines) ? lines : 80);
  if (output === null) fail(`could not capture output for ${id}`);
  console.log(options.clean ? cleanTerminalOutput(output) : output);
  return 0;
}

function outputCommand(positional: string[], options: Options): number {
  const id = requiredJobId(positional);
  const output = getJobFullOutput(id);
  if (output === null) fail(`could not read output for ${id}`);
  console.log(options.clean ? cleanTerminalOutput(output) : output);
  return 0;
}

function jobsCommand(options: Options): number {
  if (options.json) {
    console.log(JSON.stringify(getJobsJson({ all: options.all, limit: options.limit }), null, 2));
    return 0;
  }
  const jobs = sortJobs(listJobs({ all: options.all, limit: options.limit }));
  if (jobs.length === 0) {
    console.log("No jobs");
    return 0;
  }
  console.log("ID        STATUS      ELAPSED   MODE    PROMPT");
  console.log("-".repeat(86));
  for (const job of jobs) console.log(formatJob(job));
  return 0;
}

function sessionsCommand(): number {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log("No active cursor-agent sessions");
    return 0;
  }
  for (const session of sessions) console.log(`${session.name}\tattached=${session.attached ? "yes" : "no"}\t${session.created}`);
  return 0;
}

function attachCommand(positional: string[]): number {
  const id = requiredJobId(positional);
  const command = getAttachCommand(id);
  if (!command) fail(`job not found or has no tmux session: ${id}`);
  console.log(command);
  return 0;
}

async function watchCommand(positional: string[], options: Options): Promise<number> {
  const id = requiredJobId(positional);
  let previous = "";
  while (true) {
    const output = getJobOutput(id, 120);
    if (output && output !== previous) {
      const visible = options.clean ? cleanTerminalOutput(output) : output;
      console.clear();
      console.log(visible);
      previous = output;
    }
    const job = refreshJobStatus(id);
    if (!job || (job.status !== "running" && job.status !== "pending")) return 0;
    await Bun.sleep(1000);
  }
}

function controlCommand(positional: string[], fn: (id: string) => boolean, verb: string): number {
  const id = requiredJobId(positional);
  if (!fn(id)) fail(`could not control job: ${id}`);
  console.log(`${verb} job: ${id}`);
  return 0;
}

function cleanCommand(): number {
  const result = cleanupOldJobs(7);
  console.log(`Archived ${result.jobsArchived} old jobs and killed ${result.orphanedSessionsKilled} orphaned tmux sessions`);
  return 0;
}

function healthCommand(): number {
  const tmux = spawnSync("tmux", ["-V"], { encoding: "utf8", timeout: 5_000 });
  console.log(tmux.status === 0 ? `tmux: ${tmux.stdout.trim()}` : "tmux: missing");
  console.log(`agent path: ${config.agentPath}`);
  const cursor = runCommand(config.agentPath, ["--version"], 5_000);
  console.log(cursor.status === 0 ? `agent: ${cursor.stdout}` : `agent: missing (${cursor.combined || "agent --version failed"})`);
  const preflight = checkCursorAgent(config.agentPath, config.defaultModel);
  if (preflight.auth.combined) console.log(`auth: ${preflight.auth.combined}`);
  if (preflight.sandboxBlocked) {
    console.log("auth guidance: blocked by macOS Keychain sandbox; rerun cursor-agent health as an approved/escalated Codex command.");
    console.log(`model ${config.defaultModel}: not checked because auth is sandbox-blocked`);
  } else {
    console.log(`model ${config.defaultModel}: ${preflight.hasModel ? "OK" : "missing"}`);
  }
  console.log(`browser-harness skill: ${existsSync(config.browserHarnessSkillPath) ? "OK" : "missing"}`);
  console.log(`browser-harness canonical doc: ${existsSync(config.browserHarnessCanonicalSkillPath) ? "OK" : "missing"}`);
  console.log(`browser-harness helpers: ${existsSync(config.browserHarnessHelpersPath) ? "OK" : "missing"}`);
  console.log(`Cursor browser-harness plugin: ${existsSync(config.browserHarnessPluginDir) ? "OK" : "missing"}`);
  const harness = spawnSync("which", ["browser-harness"], { encoding: "utf8", timeout: 5_000 });
  console.log(harness.status === 0 ? `browser-harness: ${harness.stdout.trim()}` : "browser-harness: missing");
  return tmux.status === 0 && preflight.ok ? 0 : 1;
}

function normalizeBrowserHarnessSandbox(options: Options): void {
  if (!options.browserHarness) return;
  if (options.sandboxExplicit && options.sandbox === "enabled" && !config.allowBrowserHarnessSandbox) {
    fail(
      [
        "browser-harness QA cannot run with Cursor Agent sandbox enabled.",
        "The harness needs localhost CDP access, and sandboxed Cursor tool calls can mis-detect Chrome and hang or fail.",
        "Use --sandbox disabled, omit --sandbox so cursor-agent can choose the QA default, or pass --no-browser-harness for non-browser work.",
        "Set CURSOR_AGENT_ALLOW_BROWSER_HARNESS_SANDBOX=1 only when intentionally testing sandbox failure behavior."
      ].join("\n")
    );
  }
  if (!options.sandboxExplicit) options.sandbox = "disabled";
}

function preflightStart(options: Options): void {
  const preflight = checkCursorAgent(config.agentPath, options.model);
  if (preflight.ok) return;
  fail(preflight.message ?? "Cursor Agent preflight failed");
}

function requiredJobId(positional: string[]): string {
  const id = positional[0];
  if (!id) fail("job id is required");
  return id;
}

function sortJobs(jobs: Job[]): Job[] {
  const rank: Record<Job["status"], number> = { running: 0, pending: 1, failed: 2, completed: 3 };
  return [...jobs].sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function formatJob(job: Job): string {
  const elapsed = formatDuration(elapsedMs(job));
  const prompt = job.prompt.length > 54 ? `${job.prompt.slice(0, 54)}...` : job.prompt;
  return `${job.id}  ${job.status.toUpperCase().padEnd(10)}  ${elapsed.padEnd(8)}  ${job.mode.padEnd(7)} ${prompt}`;
}

function elapsedMs(job: Job): number {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = Date.parse(job.completedAt ?? new Date().toISOString());
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const exitCode = await main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  return 1;
});
process.exit(exitCode);
