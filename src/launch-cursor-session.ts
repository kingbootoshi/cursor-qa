#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { loadLaunchSpec, markJobExited } from "./jobs.ts";

const jobId = process.argv[2];
if (!jobId) process.exit(1);

let exitCode = 1;
let errorMessage: string | undefined;
let rawOutput = "";

try {
  const spec = loadLaunchSpec(jobId);
  const prompt = readFileSync(spec.promptFile, "utf8");
  const proc = Bun.spawn([spec.agentPath, ...spec.args, prompt], {
    cwd: spec.cwd,
    env: { ...Bun.env },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr] = await Promise.all([
    mirrorStream(proc.stdout, process.stdout),
    mirrorStream(proc.stderr, process.stderr)
  ]);
  exitCode = await proc.exited;
  rawOutput = `${stdout}${stderr}`;
} catch (cause) {
  errorMessage = cause instanceof Error ? cause.message : String(cause);
  console.error(`cursor-agent launch failed: ${errorMessage}`);
}

markJobExited(jobId, exitCode, errorMessage, rawOutput);
console.log(`\n\n[cursor-agent: Session complete with exit code ${exitCode}. Closing in 5s.]`);
await Bun.sleep(5000);

process.exit(exitCode);

async function mirrorStream(
  stream: ReadableStream<Uint8Array> | null,
  target: NodeJS.WriteStream
): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    target.write(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
