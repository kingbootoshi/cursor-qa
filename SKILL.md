---
name: cursor-qa
description: Delegate QA and fast browser-harness E2E testing to Cursor Composer 2.5 Fast through the local cursor-agent tmux wrapper. Use when Codex should write a test brief, ask Cursor to exercise a UI or browser workflow, and receive a structured QA report with evidence, failures, reproduction notes, and retest status.
---

# Cursor QA

Use `cursor-agent` to send fast QA work to Cursor Composer 2.5 Fast while Codex keeps implementation context focused.

## Outcome

Goal: Turn a development change into a focused QA brief, run it through Cursor with browser-harness, and bring back a report Codex can act on.

Success means:
- Codex gives Cursor a bounded test brief with target URL, flows, expected behavior, and report fields.
- Cursor uses browser-harness for browser interaction, visible verification, screenshots or page state, and reproduction notes.
- Cursor returns a QA report with verdict, coverage, failures, evidence, and retest instructions.

Stop when: Cursor returns a report that lets Codex fix a concrete issue, request a retest, or record a passing QA result.

## Standard Loop

Start a QA run:

```bash
cursor-agent start "<qa brief>" --dir /path/to/repo --force
cursor-agent await-turn <jobId>
cursor-agent capture <jobId> 220 --clean
cursor-agent status <jobId>
```

Retest after a fix:

```bash
cursor-agent send <jobId> "Retest the same brief against the updated app. Report only current failures and changed evidence."
cursor-agent await-turn <jobId>
cursor-agent capture <jobId> 220 --clean
```

List running or recent QA jobs:

```bash
cursor-agent jobs --json
```

## Write The QA Brief

Build the prompt as a test contract. Name the destination, the exact surfaces to test, and the report schema.

Use this structure:

```text
Goal: QA <feature/change> at <URL> with browser-harness.

Success means:
- <flow 1> reaches <expected state>
- <flow 2> handles <edge case>
- <visual/layout requirement> holds at <viewport>
- The report includes verdict, steps, evidence, failures, and reproduction notes

Stop when: The report covers every listed flow once and gives a final PASS or FAIL verdict.

Use browser-harness:
- Open a fresh tab with new_tab("<URL>")
- Verify visible state with screenshot(), page_info(), and focused DOM reads
- Click and type through the browser like a user
- Capture evidence after each meaningful action

Return this report:
RESULT: PASS | FAIL
TARGET:
COVERAGE:
EVIDENCE:
FAILURES:
REPRODUCTION:
RETEST NOTES:
```

## Browser-Harness Expectations

`cursor-agent` injects browser-harness by default. The Cursor agent receives:

- The local Cursor plugin at `~/.cursor/plugins/local/browser-harness`.
- The copied browser-harness skill.
- The canonical browser-harness usage doc and helper reference.

Ask Cursor to use browser-harness for visible browser work. Ask for screenshots or page state when the report depends on UI evidence.

## QA Scope Examples

Smoke test a local app:

```bash
cursor-agent start "Goal: QA the onboarding flow at http://localhost:3000 with browser-harness.

Success means:
- The landing screen loads without console-visible blocking errors
- The primary CTA opens onboarding
- Required fields show validation when submitted empty
- A valid test profile reaches the final confirmation screen

Stop when: You return one PASS or FAIL report with evidence for each step.

Return RESULT, TARGET, COVERAGE, EVIDENCE, FAILURES, REPRODUCTION, RETEST NOTES." \
  --dir /path/to/repo --force
```

Retest a fixed failure:

```bash
cursor-agent send <jobId> "Retest the failed validation path. Use the same URL and browser-harness flow. Return PASS if the previous failure is gone, otherwise return FAIL with updated reproduction steps."
```

## Report Triage

Read Cursor's report, then choose the next action:

- Fix implementation bugs when the report includes a reproducible failure.
- Ask Cursor for one focused retest when evidence is incomplete.
- Record PASS when the report covers the brief and no failures remain.
- Broaden QA only when the change surface is larger than the original brief.

## Health Check

Run this when Cursor, tmux, model access, or browser-harness setup is suspect:

```bash
cursor-agent health
```

The health check verifies tmux, Cursor auth, `composer-2.5-fast`, browser-harness files, the Cursor plugin, and the `browser-harness` executable.
