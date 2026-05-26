<p align="center">
  <img src="assets/cursor-qa-header.jpeg" alt="Cursor QA header" width="100%">
</p>

# Cursor QA

`cursor-qa` packages a Codex skill and a tmux-backed Cursor Agent CLI for fast QA delegation.

Codex writes a focused QA brief, Cursor Composer 2.5 Fast runs it through `browser-harness`, and the result comes back as a report with verdict, coverage, evidence, failures, reproduction notes, and retest guidance.

## Install

```bash
bun install
bun link
```

This exposes:

```bash
cursor-agent
cursor-qa
```

Both commands run the same CLI. `cursor-agent` is the orchestration command used by the skill.

## Requirements

- Bun
- tmux
- Cursor Agent CLI available as `agent`
- Cursor CLI authenticated with access to `composer-2.5-fast`
- `browser-harness` available on PATH for browser QA work

## Quick Start

```bash
cursor-agent health
cursor-agent start "Goal: QA http://localhost:3000 with browser-harness.

Success means:
- The page loads
- The primary action works
- The report includes RESULT, TARGET, COVERAGE, EVIDENCE, FAILURES, REPRODUCTION, RETEST NOTES

Stop when: You return one PASS or FAIL report." --dir . --force
cursor-agent await-turn <jobId>
cursor-agent capture <jobId> 220 --clean
```

## Skill

The Codex skill lives at:

```text
SKILL.md
agents/openai.yaml
```

Install it into Codex by copying this repository folder to your skills directory, or copy `SKILL.md` and `agents/openai.yaml` into a `cursor-qa` skill folder.

## Cursor Plugin Payload

The browser-harness Cursor plugin payload lives at:

```text
cursor-plugin/browser-harness/
```

The runtime wrapper defaults to the local Cursor plugin path:

```text
~/.cursor/plugins/local/browser-harness
```

Copy or symlink the plugin payload there if the local plugin is missing.
