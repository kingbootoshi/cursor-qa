import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function loadCodebaseMap(cwd: string): string | null {
  for (const candidate of [
    resolve(cwd, "docs/CODEBASE_MAP.md"),
    resolve(cwd, "CODEBASE_MAP.md"),
    resolve(cwd, "docs/ARCHITECTURE.md")
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Try the next conventional map path.
    }
  }
  return null;
}

