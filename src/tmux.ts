import { spawnSync } from "node:child_process";
import { config } from "./config.ts";
import { shellQuote } from "./shell.ts";

export interface TmuxSession {
  name: string;
  attached: boolean;
  created: string;
}

export function getSessionName(jobId: string): string {
  return `${config.tmuxPrefix}-${jobId}`;
}

export function isTmuxAvailable(): boolean {
  return spawnSync("tmux", ["-V"], { stdio: "pipe" }).status === 0;
}

export function sessionExists(sessionName: string): boolean {
  return spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" }).status === 0;
}

export function listSessions(): TmuxSession[] {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{session_created_string}"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith(`${config.tmuxPrefix}-`))
    .map((line) => {
      const [name = "", attached = "0", created = ""] = line.split("\t");
      return { name, attached: attached !== "0", created };
    });
}

export function createSession(input: {
  jobId: string;
  cwd: string;
  logFile: string;
  launcherPath: string;
}): { sessionName: string; success: boolean; error?: string } {
  const sessionName = getSessionName(input.jobId);
  const launcherCommand = `${agentHomeEnvPrefix()}bun ${shellQuote(input.launcherPath)} ${shellQuote(input.jobId)}`;
  const command =
    process.platform === "linux"
      ? `script -q -e -c ${shellQuote(launcherCommand)} ${shellQuote(input.logFile)}`
      : `script -q ${shellQuote(input.logFile)} ${launcherCommand}`;
  const result = spawnSync("tmux", ["new-session", "-d", "-s", sessionName, "-c", input.cwd, command], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status === 0) return { sessionName, success: true };
  return { sessionName, success: false, error: result.stderr || result.stdout || "tmux new-session failed" };
}

function agentHomeEnvPrefix(): string {
  return process.env.CURSOR_AGENT_HOME === undefined ? "" : `/usr/bin/env CURSOR_AGENT_HOME=${shellQuote(config.homeDir)} `;
}

export function killSession(sessionName: string): boolean {
  return spawnSync("tmux", ["kill-session", "-t", sessionName], { stdio: "pipe" }).status === 0;
}

export function sendMessage(sessionName: string, message: string): boolean {
  if (!sessionExists(sessionName)) return false;
  const bufferName = `${sessionName}-${process.pid}`;
  const loaded = spawnSync("tmux", ["load-buffer", "-b", bufferName, "-"], {
    input: message,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (loaded.status !== 0) return false;
  const pasted = spawnSync("tmux", ["paste-buffer", "-b", bufferName, "-t", sessionName], { stdio: "pipe" });
  spawnSync("tmux", ["delete-buffer", "-b", bufferName], { stdio: "pipe" });
  if (pasted.status !== 0) return false;
  spawnSync("tmux", ["send-keys", "-t", sessionName, "Enter"], { stdio: "pipe" });
  return true;
}

export function capturePane(sessionName: string, lines?: number): string | null {
  if (!sessionExists(sessionName)) return null;
  const result = spawnSync("tmux", ["capture-pane", "-t", sessionName, "-p", "-S", "-"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) return null;
  if (lines === undefined) return result.stdout;
  return result.stdout.split("\n").slice(-lines).join("\n");
}
