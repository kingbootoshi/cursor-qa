import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";

export interface TurnEvent {
  event: "Stop" | "StopFailure";
  jobId: string;
  timestamp: string;
  sessionId?: string;
  cwd?: string;
  transcriptPath?: string;
  permissionMode?: string;
  model?: string;
  effort?: string;
  lastAgentMessage?: string;
}

function signalPath(jobId: string): string {
  return join(config.jobsDir, `${jobId}.turn-complete.json`);
}

export function signalFileExists(jobId: string): boolean {
  return existsSync(signalPath(jobId));
}

export function readSignalFile(jobId: string): TurnEvent | null {
  try {
    return JSON.parse(readFileSync(signalPath(jobId), "utf8")) as TurnEvent;
  } catch {
    return null;
  }
}

export function writeSignalFile(event: TurnEvent): void {
  const target = signalPath(event.jobId);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(event, null, 2));
  renameSync(temp, target);
}

export function clearSignalFile(jobId: string): void {
  const target = signalPath(jobId);
  if (!existsSync(target)) return;
  renameSync(target, join(config.jobsDir, `${jobId}.turn-previous.json`));
}

