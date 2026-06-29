# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@qwipo/aiagent` (the `qwipo` command) is a local DevOps assistant for Qwipo's Azure DevOps. A user asks in plain English; the agent triggers builds/releases, lists work items, checks pipeline status, etc. The LLM runs **locally via Ollama** (`qwen2.5:7b` by default) — nothing leaves the machine except `az` CLI calls. There is no hosted backend.

## Commands

```bash
npm start              # interactive CLI agent (= node index.js)
npm run setup          # configure org/project/model (= qwipo --setup)
npm run web            # Build & Release web UI on http://localhost:4317
npm run app            # Electron desktop wrapper (boots the web server in a window)
npm run dist           # build universal macOS .dmg via electron-builder

qwipo --prompt "..."   # headless one-shot, for agent-to-agent (auto-confirms writes)
qwipo builds <svc>     # direct commands: builds | releases | status | trigger | services
```

There is **no test suite, linter, or build step** for the CLI itself — it runs straight from source. The only build is `npm run dist` (Electron packaging).

To run a single thing manually: `node index.js --prompt "recent builds for bms-core-service"`.

## Prerequisites at runtime

The agent shells out to the **Azure CLI** (`az`), which must be installed, logged in (`az login`), and have the `azure-devops` extension. Org/project come from config (`qwipo --setup`) or env vars `AZURE_DEVOPS_ORG` / `AZURE_DEVOPS_PROJECT`. Ollama must be running on `localhost:11434`. Config is stored via `configstore` at `~/.config/configstore/aiagent.json`.

## Architecture

**Entry point** (`index.js`) routes args to one of: `--setup`, `--web`, `--prompt` (headless), direct commands, or interactive mode. It also contains a **self-update block** that runs `git pull --ff-only` once per 24h (skipped in `--prompt` mode; opt out with `QWIPO_NO_UPDATE=1` or `--no-update`).

**The agent loop** is a hand-rolled ReAct loop, not the Anthropic SDK's tool-use. Both `src/core/agent.js` (interactive) and `src/core/headless.js` (one-shot) work the same way:
1. Send the conversation to Ollama (`src/core/ollama.js`).
2. `src/core/parser.js` tries to extract a `{"tool": ..., "args": ...}` JSON object from the model's free-text reply (handles code fences, surrounding prose, etc.).
3. If a tool call is found, run it and feed the result back as a user message; otherwise treat the reply as the final answer.
4. Loop up to `MAX_TOOL_STEPS` (10).

The model is steered entirely by a large hand-tuned system prompt in `src/core/prompt.js` containing strict "WORKFLOW RECIPES" — because the local 7B models are unreliable, the prompt enforces the resolve→confirm→execute flow, READ vs WRITE detection, chitchat gating, and anti-hallucination rules.

**Deterministic write path (important):** the local model is *too unreliable to trust with build/release commands*, so build/release/deploy requests bypass the LLM entirely. `src/core/intent.js` (`parseWriteIntent`) regex-parses the user input for action + service(s) + branch + environment; `handleWriteIntent` in `agent.js` then resolves services, shows an interactive confirm selector, and calls the tools directly. The LLM only handles chitchat, READ queries, and work-item/diff requests. `agent.js` also has runtime guards that intercept the LLM trying to confirm a write without having resolved the service first.

**Tools** (`src/tools/*.js`) are auto-loaded by `src/tools/index.js` — every file except `index.js` must export `{ name, description, fn, input_schema }`. All tools shell out through `execAzCli` in `src/utils/shell.js` (a promisified `execFile` wrapper with timeout + debug logging). `az_resolve_service` is the keystone tool: it maps a friendly name to pipeline IDs via `src/config/serviceAliases.js` using exact → partial → fuzzy (Levenshtein) matching, and is expected to run *first* whenever a service is named.

**Service aliases** (`src/config/serviceAliases.js`) is the hardcoded source of truth mapping service names → `{ buildPipelineId, releasePipelineId }`. Add new services here.

**Web UI** (`src/web/server.js`) is a zero-dependency Node `http` server (no Express) serving `public/index.html` plus a small JSON/NDJSON-streaming API for Build & Release. It reuses the same `execAzCli` + `serviceAliases` as the CLI. It also has a local plaintext credentials vault (`credentials.json`, gitignored) read from `QWIPO_DATA_DIR` or its own dir.

**Electron** (`electron/`) does not reimplement anything — `main.js` forks `src/web/server.js` as a child process (with `ELECTRON_RUN_AS_NODE=1`) and shows it in a native window. It handles macOS GUI PATH loss (`fixPath`), first-run dependency/login gating (`depcheck.js`), org/project setup (`config.js`, `setup.html`), and GitHub-release auto-update (`updater.js`).

## Conventions & gotchas

- `src/core/claude.js` (the Anthropic SDK wrapper) and `getClaudeTools` in `tools/index.js` are **legacy/unused** — the live path is Ollama. The `@anthropic-ai/sdk` dependency exists but isn't on the active code path. Don't assume the Anthropic API is in use.
- Config values in `src/config/index.js` are read **once at module load** via `getConfig`, so changing config requires a restart.
- Safety rules enforced in code (not just the prompt): builds/releases from `main`/`master` are rejected in `az_trigger_build`; prod/staging deploys are blocked.
- Tools return **plain strings** (often pre-formatted). `agent.js` has a `directDisplayTools` list whose output is shown verbatim and the LLM is told not to reformat.
- The interactive prompt in `agent.js` is a custom raw-mode readline implementation (bracketed-paste handling, slash-command menu, debug toggle on Ctrl+L) — edit carefully.
