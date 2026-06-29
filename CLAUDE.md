# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@qwipo/aiagent` (the `qwipo` command) is a local DevOps tool for Qwipo's Azure DevOps. It triggers builds/releases, lists recent builds, and checks pipeline status from the terminal or a built-in web UI. Everything is deterministic and command-driven — it shells out to the Azure CLI (`az`). There is no LLM and no hosted backend.

> History: this started as an Ollama-powered natural-language agent. The LLM layer (agent loop, system prompt, response parser, Ollama/Anthropic clients) has been removed; only the deterministic command/web functionality remains. If you find stray references to "agent", a model, or natural language, they are leftovers worth cleaning up.

## Commands

```bash
npm run setup          # configure org/project (= qwipo --setup)
npm run web            # Build & Release web UI on http://localhost:4317
npm run app            # Electron desktop wrapper (boots the web server in a window)
npm run dist           # build universal macOS .dmg via electron-builder

qwipo builds <service>            # list recent builds
qwipo releases <service>          # list recent releases
qwipo status <build-id>           # check build status
qwipo trigger <service> <branch>  # trigger a build
qwipo services                    # list configured services
qwipo --web                       # web UI
qwipo                             # no args → prints the command list
```

There is **no test suite or linter** — the CLI runs straight from source. The only build is `npm run dist` (Electron packaging). To smoke-test module wiring after a change: `node --check index.js` and `node index.js help`.

## Prerequisites at runtime

The tool shells out to the **Azure CLI** (`az`), which must be installed, logged in (`az login`), and have the `azure-devops` extension. Org/project come from config (`qwipo --setup`) or env vars `AZURE_DEVOPS_ORG` / `AZURE_DEVOPS_PROJECT`. Config is stored via `configstore` at `~/.config/configstore/aiagent.json`.

## Architecture

**Entry point** (`index.js`) routes args to: `--setup`, `--web`, or `runCommand` (which handles `builds`/`releases`/`status`/`trigger`/`services` and prints usage for anything else, including no args). It also contains a **self-update block** that runs `git pull --ff-only` once per 24h (opt out with `QWIPO_NO_UPDATE=1` or `--no-update`).

**Commands** (`src/commands.js`) implement each subcommand by resolving a service to its pipeline IDs, then calling the matching tool and printing the result.

**Tools** (`src/tools/*.js`) are thin, deterministic wrappers around `az`. They are auto-loaded by `src/tools/index.js` — every file except `index.js` must export `{ name, description, fn, input_schema }`. All tools shell out through `execAzCli` in `src/utils/shell.js` (a promisified `execFile` wrapper with timeout + debug logging). `loadTools()` / `runTool()` are the only consumers now. `az_resolve_service` is the keystone: it maps a friendly name to pipeline IDs via `src/config/serviceAliases.js` using exact → partial → fuzzy (Levenshtein) matching.

> Several tools (`azListWorkItems`, `azBranchDiff`, `azListPipelines`, `azTriggerRelease`, etc.) have no CLI subcommand wired to them — they are reachable only by adding a command in `src/commands.js`. They're kept because they're useful building blocks, but note they're currently orphaned.

**Service aliases** (`src/config/serviceAliases.js`) is the hardcoded source of truth mapping service names → `{ buildPipelineId, releasePipelineId }`. Add new services here.

**Web UI** (`src/web/server.js`) is a zero-dependency Node `http` server (no Express) serving `public/index.html` plus a small JSON/NDJSON-streaming API for Build & Release. It reuses the same `execAzCli` + `serviceAliases` as the CLI (it does not go through the tools loader). It also has a local plaintext credentials vault (`credentials.json`, gitignored) read from `QWIPO_DATA_DIR` or its own dir.

**Electron** (`electron/`) does not reimplement anything — `main.js` forks `src/web/server.js` as a child process (with `ELECTRON_RUN_AS_NODE=1`) and shows it in a native window. It handles macOS GUI PATH loss (`fixPath`), first-run dependency/login gating (`depcheck.js`), org/project setup (`config.js`, `setup.html`), and GitHub-release auto-update (`updater.js`).

## Conventions & gotchas

- Config values in `src/config/index.js` are read **once at module load** via `getConfig`, so changing config requires a restart.
- Safety rules enforced in code: builds/releases from `main`/`master` are rejected in `az_trigger_build`; prod/staging deploys are blocked.
- Tools return **plain strings** (often pre-formatted) — `commands.js` prints them verbatim.
