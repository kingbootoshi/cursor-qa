---
name: browser-harness
description: Direct browser control via CDP. Use when the user wants to automate, scrape, test, or interact with web pages through their real Chrome (not the claude-in-chrome MCP). Invokes the `browser-harness` CLI which pipes Python with helpers preloaded into a daemon connected to the user's running browser. Triggers on "browser-harness", "use the harness", "drive my chrome", "scrape this site", "automate this page", or any browser-automation task where compositor-level coordinate clicks, raw CDP, or self-healing helpers are wanted.
---

# browser-harness

Self-healing CDP browser harness. The repo lives at `~/dev/browser-harness/` and the CLI `browser-harness` is on `$PATH` (installed via `uv tool install -e .`).

## Before doing anything

1. Read `~/dev/browser-harness/SKILL.md` in full — that is the canonical usage doc and must be in context before calling the CLI.
2. Read `~/dev/browser-harness/helpers.py` — that is where the functions live; the agent edits these.
3. If this is a first-time setup, attach is failing, or daemon is stale, also read `~/dev/browser-harness/install.md`.
4. Search `~/dev/browser-harness/domain-skills/` and `~/dev/browser-harness/interaction-skills/` before inventing approaches.

## Invocation shape

```bash
browser-harness <<'PY'
new_tab("https://example.com")
wait_for_load()
print(page_info())
PY
```

- First navigation is `new_tab(url)` — `goto(url)` clobbers the user's active tab.
- Helpers are pre-imported, daemon auto-starts, no `cd` or `uv run` needed.
- Verify visible actions with `screenshot()`.

## Contribute back

If a non-obvious site behavior is discovered (private API, stable selector, framework quirk, URL shortcut, wait, trap), open a PR adding to `~/dev/browser-harness/domain-skills/<site>/`. The harness improves only because agents file what they learn.
