import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { config, type AgentMode, type SandboxMode } from "./config.ts";
import { clearSignalFile, readSignalFile, signalFileExists, writeSignalFile, type TurnEvent } from "./watcher.ts";
import {
  capturePane,
  createSession,
  getSessionName,
  killSession,
  sessionExists
} from "./tmux.ts";
import { shellQuote } from "./shell.ts";

export interface CursorUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Job {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  prompt: string;
  messages: string[];
  model: string;
  mode: AgentMode;
  sandbox: SandboxMode;
  force: boolean;
  trust: boolean;
  approveMcps: boolean;
  browserHarness: boolean;
  pluginDirs: string[];
  cwd: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  tmuxSession?: string;
  cursorSessionId?: string;
  requestId?: string;
  result?: string;
  usage?: CursorUsage;
  error?: string;
  turnCount?: number;
  lastTurnCompletedAt?: string;
  lastAgentMessage?: string;
  turnState?: "working" | "idle";
}

export interface StartJobOptions {
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: AgentMode;
  sandbox?: SandboxMode;
  force?: boolean;
  trust?: boolean;
  approveMcps?: boolean;
  browserHarness?: boolean;
  pluginDirs?: readonly string[];
  resumeSessionId?: string;
  jobId?: string;
  appendMessage?: boolean;
}

export interface LaunchSpec {
  jobId: string;
  agentPath: string;
  args: string[];
  cwd: string;
  promptFile: string;
  logFile: string;
  sessionName: string;
}

export interface JobsJsonOutput {
  generated_at: string;
  jobs: Array<{
    id: string;
    status: Job["status"];
    prompt: string;
    model: string;
    mode: AgentMode;
    sandbox: SandboxMode;
    force: boolean;
    browser_harness: boolean;
    cursor_session_id: string | null;
    cwd: string;
    elapsed_ms: number;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    turn_state: Job["turnState"] | null;
    turns_completed: number;
    last_message: string | null;
    usage: CursorUsage | null;
  }>;
}

type CursorResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  request_id?: string;
  usage?: CursorUsage;
  error?: unknown;
};

export function ensureJobsDir(): void {
  mkdirSync(config.jobsDir, { recursive: true });
}

function ensureTrashDir(): void {
  mkdirSync(config.trashDir, { recursive: true });
}

function jobPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.json`);
}

function launchPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.launch.json`);
}

function logPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.log`);
}

function promptPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.prompt`);
}

function generateJobId(): string {
  return randomBytes(4).toString("hex");
}

export function saveJob(job: Job): void {
  ensureJobsDir();
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
}

export function loadJob(jobId: string): Job | null {
  try {
    return JSON.parse(readFileSync(jobPath(jobId), "utf8")) as Job;
  } catch {
    return null;
  }
}

export function loadLaunchSpec(jobId: string): LaunchSpec {
  return JSON.parse(readFileSync(launchPath(jobId), "utf8")) as LaunchSpec;
}

export function listJobs(options: { all?: boolean; limit?: number | null } = {}): Job[] {
  ensureJobsDir();
  const jobs = readdirSync(config.jobsDir)
    .filter(isJobJsonFile)
    .map((file) => loadJob(file.slice(0, -5)))
    .filter((job): job is Job => job !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (options.all) return jobs;
  const active = jobs.filter((job) => job.status === "running" || job.status === "pending");
  const activeIds = new Set(active.map((job) => job.id));
  const recent = jobs
    .filter((job) => !activeIds.has(job.id))
    .slice(0, Math.max((options.limit ?? config.jobsListLimit) - active.length, 0));
  return [...active, ...recent];
}

function isJobJsonFile(file: string): boolean {
  return file.endsWith(".json") && !file.endsWith(".launch.json") && !file.endsWith(".turn-complete.json") && !file.endsWith(".turn-previous.json");
}

export function startJob(options: StartJobOptions): Job {
  ensureJobsDir();
  const existing = options.jobId ? loadJob(options.jobId) : null;
  const id = options.jobId ?? generateJobId();
  const cwd = resolve(options.cwd ?? existing?.cwd ?? process.cwd());
  const tmuxSession = getSessionName(id);
  const model = options.model ?? existing?.model ?? config.defaultModel;
  const mode = options.mode ?? existing?.mode ?? config.defaultMode;
  const sandbox = options.sandbox ?? existing?.sandbox ?? config.defaultSandbox;
  const force = options.force ?? existing?.force ?? false;
  const trust = options.trust ?? existing?.trust ?? true;
  const approveMcps = options.approveMcps ?? existing?.approveMcps ?? false;
  const browserHarness = options.browserHarness ?? existing?.browserHarness ?? true;
  const pluginDirs = [...new Set([...(existing?.pluginDirs ?? []), ...(options.pluginDirs ?? [])])];
  const messages = options.appendMessage && existing ? [...existing.messages, options.prompt] : [options.prompt];

  const job: Job = {
    id,
    status: "pending",
    prompt: messages[0] ?? options.prompt,
    messages,
    model,
    mode,
    sandbox,
    force,
    trust,
    approveMcps,
    browserHarness,
    pluginDirs,
    cwd,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    tmuxSession,
    cursorSessionId: options.resumeSessionId ?? existing?.cursorSessionId,
    turnState: "working",
    turnCount: existing?.turnCount ?? 0
  };
  saveJob(job);
  clearSignalFile(id);
  writeFileSync(promptPath(id), options.prompt);
  writeLaunchSpec(id, {
    jobId: id,
    agentPath: config.agentPath,
    args: buildAgentArgs({
      model,
      mode,
      sandbox,
      force,
      trust,
      approveMcps,
      pluginDirs,
      resumeSessionId: options.resumeSessionId ?? existing?.cursorSessionId,
      cwd
    }),
    cwd,
    promptFile: promptPath(id),
    logFile: logPath(id),
    sessionName: tmuxSession
  });

  const created = createSession({ jobId: id, cwd, logFile: logPath(id), launcherPath: join(import.meta.dir, "launch-cursor-session.ts") });
  if (!created.success) {
    job.status = "failed";
    job.error = created.error ?? "failed to create tmux session";
    job.completedAt = new Date().toISOString();
    job.turnState = "idle";
  } else {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.completedAt = undefined;
    job.error = undefined;
  }
  saveJob(job);
  return job;
}

function writeLaunchSpec(jobId: string, spec: LaunchSpec): void {
  writeFileSync(launchPath(jobId), JSON.stringify(spec, null, 2));
}

function buildAgentArgs(input: {
  model: string;
  mode: AgentMode;
  sandbox: SandboxMode;
  force: boolean;
  trust: boolean;
  approveMcps: boolean;
  pluginDirs: readonly string[];
  resumeSessionId?: string;
  cwd: string;
}): string[] {
  const args = [
    "-p",
    "--model",
    input.model,
    "--output-format",
    "json",
    "--sandbox",
    input.sandbox,
    "--workspace",
    input.cwd
  ];
  if (input.mode !== "agent") args.push("--mode", input.mode);
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  if (input.force) args.push("--force");
  if (input.trust) args.push("--trust");
  if (input.approveMcps) args.push("--approve-mcps");
  for (const pluginDir of input.pluginDirs) args.push("--plugin-dir", pluginDir);
  return args;
}

export function refreshJobStatus(jobId: string): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  if ((job.status === "pending" || job.status === "running") && job.tmuxSession && !sessionExists(job.tmuxSession)) {
    const fromDisk = loadJob(jobId) ?? job;
    if (fromDisk.status === "pending" || fromDisk.status === "running") {
      applyCursorResult(fromDisk, parseCursorResultFromLog(jobId));
      if (fromDisk.status === "pending" || fromDisk.status === "running") {
        fromDisk.status = fromDisk.error ? "failed" : "completed";
      }
      fromDisk.completedAt = fromDisk.completedAt ?? new Date().toISOString();
      fromDisk.turnState = "idle";
      saveJob(fromDisk);
    }
    return loadJob(jobId);
  }
  if (job.status === "running" && isInactiveTimedOut(job)) {
    if (job.tmuxSession) killSession(job.tmuxSession);
    job.status = "failed";
    job.error = `Timed out after ${config.defaultTimeoutMinutes} minutes of inactivity`;
    job.completedAt = new Date().toISOString();
    job.turnState = "idle";
    saveJob(job);
  }
  return loadJob(jobId);
}

export function markJobExited(jobId: string, exitCode: number, error?: string, rawOutput?: string): void {
  const job = loadJob(jobId);
  if (!job) return;
  applyCursorResult(job, rawOutput ? parseCursorResultFromText(rawOutput) : parseCursorResultFromLog(jobId));
  job.status = exitCode === 0 && !job.error && !error ? "completed" : "failed";
  job.completedAt = new Date().toISOString();
  job.turnState = "idle";
  if (error !== undefined) job.error = error;
  try {
    job.result = job.result ?? rawOutput ?? readFileSync(logPath(jobId), "utf8");
  } catch {
    // Log capture is best effort.
  }
  job.turnCount = (job.turnCount ?? 0) + 1;
  job.lastTurnCompletedAt = new Date().toISOString();
  job.lastAgentMessage = job.result ? truncate(cleanOutputForMessage(job.result), 700) : exitCode === 0 ? "Cursor turn complete" : "Cursor turn failed";
  saveJob(job);

  const signal: TurnEvent = {
    event: job.status === "completed" ? "Stop" : "StopFailure",
    jobId,
    timestamp: job.lastTurnCompletedAt,
    sessionId: job.cursorSessionId,
    cwd: job.cwd,
    model: job.model,
    lastAgentMessage: job.lastAgentMessage
  };
  writeSignalFile(signal);
}

export function sendToJob(jobId: string, message: string): boolean {
  const job = refreshJobStatus(jobId);
  if (!job || !job.cursorSessionId) return false;
  if (job.status === "running" || job.status === "pending") return false;
  startJob({
    jobId,
    prompt: message,
    cwd: job.cwd,
    model: job.model,
    mode: job.mode,
    sandbox: job.sandbox,
    force: job.force,
    trust: job.trust,
    approveMcps: job.approveMcps,
    browserHarness: job.browserHarness,
    pluginDirs: job.pluginDirs,
    resumeSessionId: job.cursorSessionId,
    appendMessage: true
  });
  return true;
}

export function killJob(jobId: string): boolean {
  const job = loadJob(jobId);
  if (!job) return false;
  if (job.tmuxSession && sessionExists(job.tmuxSession)) killSession(job.tmuxSession);
  job.status = "failed";
  job.error = "Killed by user";
  job.completedAt = new Date().toISOString();
  job.turnState = "idle";
  saveJob(job);
  return true;
}

export function getJobOutput(jobId: string, lines?: number): string | null {
  const job = loadJob(jobId);
  if (!job) return null;
  if (job.tmuxSession && sessionExists(job.tmuxSession)) {
    const pane = capturePane(job.tmuxSession, lines);
    if (pane !== null && (pane.trim().length > 0 || job.status === "running" || job.status === "pending")) return pane;
  }
  try {
    const content = readFileSync(logPath(jobId), "utf8");
    return lines === undefined ? content : content.split("\n").slice(-lines).join("\n");
  } catch {
    return null;
  }
}

export function getJobFullOutput(jobId: string): string | null {
  return getJobOutput(jobId);
}

export function isJobIdle(jobId: string): boolean {
  return signalFileExists(jobId);
}

export function getTurnSignal(jobId: string) {
  return readSignalFile(jobId);
}

export function getAttachCommand(jobId: string): string | null {
  const job = loadJob(jobId);
  if (!job?.tmuxSession) return null;
  return `tmux attach -t ${shellQuote(job.tmuxSession)}`;
}

export function deleteJob(jobId: string): boolean {
  const job = loadJob(jobId);
  if (job?.tmuxSession && sessionExists(job.tmuxSession)) killSession(job.tmuxSession);
  ensureTrashDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const targetDir = join(config.trashDir, `${jobId}-${stamp}`);
  mkdirSync(targetDir, { recursive: true });
  let moved = false;
  for (const suffix of [".json", ".launch.json", ".prompt", ".log", ".turn-complete.json", ".turn-previous.json"]) {
    const path = join(config.jobsDir, `${jobId}${suffix}`);
    if (!existsSync(path)) continue;
    renameSync(path, join(targetDir, `${jobId}${suffix}`));
    moved = true;
  }
  return moved;
}

export function cleanupOldJobs(maxAgeDays = 7): { jobsArchived: number; orphanedSessionsKilled: number } {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let jobsArchived = 0;
  for (const job of listJobs({ all: true })) {
    const time = Date.parse(job.completedAt ?? job.createdAt);
    if (Number.isFinite(time) && time < cutoff && (job.status === "completed" || job.status === "failed")) {
      if (deleteJob(job.id)) jobsArchived += 1;
    }
  }
  return { jobsArchived, orphanedSessionsKilled: 0 };
}

export function getJobsJson(options: { all?: boolean; limit?: number | null } = {}): JobsJsonOutput {
  return {
    generated_at: new Date().toISOString(),
    jobs: listJobs(options).map((job) => {
      const refreshed = job.status === "running" || job.status === "pending" ? refreshJobStatus(job.id) ?? job : job;
      return {
        id: refreshed.id,
        status: refreshed.status,
        prompt: truncate(refreshed.prompt, 160),
        model: refreshed.model,
        mode: refreshed.mode,
        sandbox: refreshed.sandbox,
        force: refreshed.force,
        browser_harness: refreshed.browserHarness,
        cursor_session_id: refreshed.cursorSessionId ?? null,
        cwd: refreshed.cwd,
        elapsed_ms: elapsedMs(refreshed),
        created_at: refreshed.createdAt,
        started_at: refreshed.startedAt ?? null,
        completed_at: refreshed.completedAt ?? null,
        turn_state: refreshed.turnState ?? null,
        turns_completed: refreshed.turnCount ?? 0,
        last_message: refreshed.lastAgentMessage ?? null,
        usage: refreshed.usage ?? null
      };
    })
  };
}

function applyCursorResult(job: Job, result: CursorResult | null): void {
  if (!result) return;
  if (typeof result.session_id === "string") job.cursorSessionId = result.session_id;
  if (typeof result.request_id === "string") job.requestId = result.request_id;
  if (typeof result.result === "string") job.result = result.result;
  if (result.usage) job.usage = result.usage;
  if (result.is_error || result.subtype === "error") {
    job.error = typeof result.error === "string" ? result.error : result.result ?? "Cursor Agent returned an error";
  }
}

function parseCursorResultFromLog(jobId: string): CursorResult | null {
  let content = "";
  try {
    content = readFileSync(logPath(jobId), "utf8");
  } catch {
    return null;
  }
  return parseCursorResultFromText(content);
}

function parseCursorResultFromText(content: string): CursorResult | null {
  const clean = stripAnsi(content).replace(/\r/g, "\n");
  for (const line of clean.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(trimmed) as CursorResult;
      if (parsed.type === "result") return parsed;
    } catch {
      // Keep looking for the final JSON result line.
    }
  }
  return null;
}

function isInactiveTimedOut(job: Job): boolean {
  if (!Number.isFinite(config.defaultTimeoutMinutes) || config.defaultTimeoutMinutes <= 0) return false;
  const mtime = safeMtime(logPath(job.id));
  const fallback = Date.parse(job.startedAt ?? job.createdAt);
  const last = mtime ?? (Number.isFinite(fallback) ? fallback : Date.now());
  return Date.now() - last > config.defaultTimeoutMinutes * 60_000;
}

function safeMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function elapsedMs(job: Job): number {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = Date.parse(job.completedAt ?? new Date().toISOString());
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function cleanOutputForMessage(value: string): string {
  const clean = stripAnsi(value).trim();
  const parsed = parseJsonLine(clean);
  if (parsed?.result) return parsed.result;
  return clean;
}

function parseJsonLine(value: string): CursorResult | null {
  for (const line of value.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed) as CursorResult;
    } catch {
      return null;
    }
  }
  return null;
}

export function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
