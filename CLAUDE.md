# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@qwipo/aiagent` is a local DevOps **web app** for Qwipo's Azure DevOps. It triggers builds/releases and checks pipeline status from a built-in web UI, packaged as an Electron desktop app. Everything is deterministic — it shells out to the Azure CLI (`az`). There is no LLM and no hosted server; the "backend" is a small local Node HTTP server the app boots on your machine.

> History: this started as an Ollama-powered natural-language agent, and later had a deterministic terminal CLI (`qwipo builds/trigger/...`). Both have been removed — only the web UI + its local server remain. If you find stray references to "agent", a model, natural language, or a `qwipo` command, they are leftovers worth cleaning up.

## Commands

```bash
npm run web            # Build & Release web UI on http://localhost:4317
npm run app            # Electron desktop wrapper (boots the web server in a window)
npm run dist           # build universal macOS .dmg via electron-builder
```

There is **no test suite or linter**. The only build is `npm run dist` (Electron packaging). To smoke-test after a change: `node --check src/web/server.js`, then `npm run web` and load http://localhost:4317.

## Prerequisites at runtime

The app shells out to the **Azure CLI** (`az`), which must be installed, logged in (`az login`), and have the `azure-devops` extension. Org/project come from config or env vars `AZURE_DEVOPS_ORG` / `AZURE_DEVOPS_PROJECT`. Config is stored via `configstore` at `~/.config/configstore/aiagent.json` (written by the Electron first-run setup, or the web UI via `setConfig`).

## Architecture

Two tiers: the Electron window forks a local Node server (the backend), which serves the browser UI (the frontend) and shells out to `az`.

**Backend / Web server** (`src/web/server.js`) is a zero-dependency Node `http` server (no Express) serving `public/index.html` plus a small JSON/NDJSON-streaming API for Build & Release. It shells out through `execAzCli` in `src/utils/shell.js` (a promisified `execFile` wrapper with timeout + debug logging). It also has a local plaintext credentials vault (`credentials.json`, gitignored) read from `QWIPO_DATA_DIR` or its own dir.

**Services source of truth** is a **`services.json`** location (config key `servicesUrl`, set in Workspace settings / first-run setup) — either an `http(s)` URL, a `file://` URL, or a local absolute path (validated by `isValidServicesLocation`). It's a JSON object keyed by business (project) name → an array of `{ name, buildPipelineId, releasePipelineId }`. `getServices()` loads it via `loadServicesDoc` (which routes to `fetchJson` for web URLs — follows redirects, classifies offline/HTTP/parse errors — or `readJsonFile` for local files, classifying ENOENT/EACCES/EISDIR/parse), picks `json[activeProject]`, and caches per `(org, project, url)`. There is **no** folder-discovery or static fallback — no location means no services (the API returns a clear `error`, which the UI toasts). `public/services.example.json` is the downloadable template linked in both setup surfaces.

**Config** (`src/config/index.js`) reads `AZURE_DEVOPS_ORG` / `AZURE_DEVOPS_PROJECT` / `AZURE_DEVOPS_SERVICES_URL` **once at module load** via `getConfig` (`src/setup.js`). The server also holds mutable `activeOrg` / `activeProject` / `activeServicesUrl` that `POST /api/project` updates and persists at runtime (no restart needed for a workspace switch); the module-load config is just the seed.

**Electron** (`electron/`) does not reimplement anything — `main.js` forks `src/web/server.js` as a child process (with `ELECTRON_RUN_AS_NODE=1`) and shows it in a native window. It handles macOS GUI PATH loss (`fixPath`), first-run dependency/login gating (`depcheck.js`), org/project setup (`config.js`, `setup.html`), and GitHub-release auto-update (`updater.js`).

## Conventions & gotchas

- `src/config/index.js` reads config once at module load (the seed). The web server then tracks `activeOrg`/`activeProject`/`activeServicesUrl` in memory and updates them live via `POST /api/project`, so a workspace switch needs no restart — but code that imports the `AZURE_DEVOPS_*` constants directly sees only the load-time values.
- Safety rules enforced in code: builds/releases from `main`/`master` are rejected; prod/staging deploys are blocked.
