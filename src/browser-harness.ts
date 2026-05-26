import { existsSync, readFileSync } from "node:fs";
import { config } from "./config.ts";

export function defaultBrowserHarnessPluginDirs(): string[] {
  return existsSync(config.browserHarnessPluginDir) ? [config.browserHarnessPluginDir] : [];
}

export function buildBrowserHarnessPrelude(): string {
  const copiedSkill = readIfExists(config.browserHarnessSkillPath);
  const canonicalSkill = readIfExists(config.browserHarnessCanonicalSkillPath);
  const helpersPreview = readIfExists(config.browserHarnessHelpersPath);

  const sections = [
    "## Default skill: browser-harness",
    "You have the browser-harness skill by default for browser automation and fast E2E testing.",
    "Use the `browser-harness` CLI for browser work unless the user explicitly asks for a different browser tool.",
    "Before invoking the harness for a task, read the canonical local files listed in the copied skill.",
    "",
    "### Copied browser-harness skill",
    copiedSkill,
    "",
    "### Canonical local browser-harness usage doc",
    canonicalSkill,
    "",
    "### helpers.py reference",
    helpersPreview
  ].filter((part) => part.length > 0);

  return sections.join("\n");
}

function readIfExists(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return `Missing expected file: ${path}`;
  }
}
