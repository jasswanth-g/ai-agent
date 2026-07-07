#!/usr/bin/env node
/**
 * Lightweight web UI for Build & Release.
 *
 * Zero new dependencies — uses Node's built-in http module. Serves a single-page
 * UI (public/index.html) and a small JSON/streaming API that shells out to the
 * Azure CLI. This is the app's local backend; the Electron shell forks it.
 *
 * Run:  node src/web/server.js   (or)   npm run web   (or)   npm run app
 * Then open http://localhost:4317
 *
 * Endpoints:
 *   GET  /                     -> the UI
 *   GET  /api/projects[?org=]  -> { projects: [{id,name}], org, activeOrg, activeProject, activeServicesUrl }
 *   POST /api/project          -> { org, project, servicesUrl? } switches + persists the active workspace
 *   GET  /api/services         -> { services: [{ name, buildPipelineId, releasePipelineId }], warnings, error }
 *                                 from the hosted services.json (keyed by business name)
 *   GET  /api/branches?service -> { repository, branches: [...] }   (live from Azure)
 *   POST /api/deploy           -> NDJSON stream of progress events for each job:
 *                                 build -> wait -> (success) release -> wait
 *                                 (build fail) release is skipped.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");
const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_SERVICES_URL } = require("../config");
const { setConfig } = require("../setup");

const PORT = Number(process.env.QWIPO_WEB_PORT) || 4317;
const PUBLIC_DIR = path.join(__dirname, "public");

// Active Azure DevOps org + project ("business"). Both start from config and can
// be changed at runtime via the settings popup (POST /api/project), which also
// persists them. Every `az` call below targets activeOrg / activeProject.
let activeOrg = AZURE_DEVOPS_ORG;
let activeProject = AZURE_DEVOPS_PROJECT;

// Services file (services.json) — the single source of truth for the service
// list. An http(s) URL, a file:// URL, or a local absolute path. A JSON object
// keyed by business name, each value an array of { name, buildPipelineId,
// releasePipelineId }. Set/changed in Workspace settings or first-run setup.
let activeServicesUrl = AZURE_DEVOPS_SERVICES_URL;

// Local credential/reference vault — a plaintext JSON file on this machine,
// gitignored. Stores tokens, test/dev creds, app mobile numbers, etc.
// When packaged as a desktop app the bundle is read-only, so the Electron shell
// passes QWIPO_DATA_DIR (its writable userData folder). For `npm run web` / CLI
// use it falls back to this directory, exactly as before.
const DATA_DIR = process.env.QWIPO_DATA_DIR || __dirname;
const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
function readCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
  } catch {
    return { groups: [] };
  }
}
function writeCredentials(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// Branches pre-pinned to the top of every branch dropdown as quick defaults.
const DEFAULT_BRANCHES = ["dev", "testing", "main"];

// ONDC search endpoints per environment. Kept server-side so the browser never
// picks an arbitrary target — the client only sends the env key + payload.
const ONDC_URLS = {
  dev: "https://ondc.dev.bms.qwipo.com/api/v1/core/process",
  test: "https://ondc.test.bms.qwipo.com/api/v1/core/process",
  prod: "https://ondc-svc.qwipo.com/api/v1/core/process",
};

/** POST a JSON body to an https URL and resolve { status, body, elapsed }. Proxies
 *  ONDC search calls so the browser doesn't hit CORS against the ONDC hosts. */
function httpsPostJson(targetUrl, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const u = new URL(targetUrl);
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 30000,
      },
      (resp) => {
        let body = "";
        resp.on("data", (c) => (body += c));
        resp.on("end", () => resolve({ status: resp.statusCode, body }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timed out after 30s")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/**
 * GET a URL and resolve its parsed JSON. Follows redirects (raw-file hosts often
 * 30x to a CDN) and classifies failures — network/offline vs HTTP status vs bad
 * JSON — so the UI can show a meaningful message instead of a raw stack.
 */
function fetchJson(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(targetUrl); }
    catch { return reject(new Error("The services URL is not a valid URL.")); }

    const lib = u.protocol === "http:" ? http : https;
    const req = lib.get(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        headers: { accept: "application/json", "user-agent": "deploymate" },
        timeout: 15000,
      },
      (resp) => {
        const { statusCode, headers } = resp;
        // Follow redirects to the actual file (e.g. github.com → raw CDN).
        if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirectsLeft > 0) {
          resp.resume();
          const next = new URL(headers.location, u).toString();
          return fetchJson(next, redirectsLeft - 1).then(resolve, reject);
        }
        if (statusCode < 200 || statusCode >= 300) {
          resp.resume();
          return reject(new Error(`The services URL returned HTTP ${statusCode}.`));
        }
        let body = "";
        resp.on("data", (c) => {
          body += c;
          if (body.length > 5e6) req.destroy(new Error("The services file is too large (>5MB)."));
        });
        resp.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error("The services URL did not return valid JSON.")); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timed out reaching the services URL.")));
    req.on("error", (err) => {
      const offline = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "ENETDOWN"].includes(err.code);
      reject(new Error(offline
        ? "Couldn't reach the services URL — check your internet connection."
        : `Couldn't fetch the services URL: ${err.message}`));
    });
  });
}

// A services location may be an http(s) URL, a file:// URL, or a local absolute
// path (unix `/…`, Windows `C:\…` / `C:/…`, or a UNC `\\…`).
function isValidServicesLocation(loc) {
  return /^(https?:\/\/|file:\/\/|\/|[A-Za-z]:[\\/]|\\\\)/i.test(String(loc || "").trim());
}

/** Read + parse the services document from a local file path (or file:// URL). */
async function readJsonFile(location) {
  let filePath = location;
  if (/^file:\/\//i.test(location)) {
    try { filePath = fileURLToPath(location); }
    catch { throw new Error("The services file path is not a valid file:// URL."); }
  }
  let raw;
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`No services file found at ${filePath}.`);
    if (err.code === "EACCES") throw new Error(`No permission to read the services file at ${filePath}.`);
    if (err.code === "EISDIR") throw new Error(`${filePath} is a folder, not a services file.`);
    throw new Error(`Couldn't read the services file: ${err.message}`);
  }
  try { return JSON.parse(raw); }
  catch { throw new Error("The services file does not contain valid JSON."); }
}

/** Load the services document from wherever it lives — web URL or local file. */
function loadServicesDoc(location) {
  return /^https?:\/\//i.test(location) ? fetchJson(location) : readJsonFile(location);
}

// ---------------------------------------------------------------------------
// Azure helpers
// ---------------------------------------------------------------------------

/** Look up the repository a build pipeline is wired to, so we can list its branches. */
async function getPipelineRepository(buildPipelineId) {
  const output = await execAzCli([
    "pipelines", "show",
    "--id", String(buildPipelineId),
    "--org", activeOrg,
    "--project", activeProject,
    "--output", "json",
  ]);
  const def = JSON.parse(output);
  const repo = def.repository || {};
  // Prefer id (most reliable for `az repos ref list`), fall back to name.
  return { id: repo.id, name: repo.name };
}

/** List branch short-names for a repository. */
async function listBranches(repository) {
  const output = await execAzCli([
    "repos", "ref", "list",
    "--repository", String(repository),
    "--filter", "heads/",
    "--org", activeOrg,
    "--project", activeProject,
    "--output", "json",
  ]);
  const refs = JSON.parse(output);
  return refs.map((r) => r.name.replace("refs/heads/", ""));
}

async function getBuild(buildId) {
  const output = await execAzCli([
    "pipelines", "build", "show",
    "--id", String(buildId),
    "--org", activeOrg,
    "--project", activeProject,
    "--output", "json",
  ]);
  return JSON.parse(output);
}

async function queuePipeline(definitionId, branch) {
  const branchRef = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  const output = await execAzCli([
    "pipelines", "build", "queue",
    "--definition-id", String(definitionId),
    "--branch", branchRef,
    "--org", activeOrg,
    "--project", activeProject,
    "--output", "json",
  ]);
  return JSON.parse(output);
}

/**
 * Trigger a release (ArgoCD) pipeline. The target environment is decided by the
 * `environment` TEMPLATE PARAMETER, not the branch — passing only a branch makes
 * the pipeline fall back to its default (dev). We use `az pipelines run` because
 * `az pipelines build queue` cannot pass template parameters. The branch is still
 * the source code: dev branch for dev, testing/staging from the selected branch,
 * main for production.
 */
async function queueRelease(definitionId, branch, environment) {
  const branchRef = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  const output = await execAzCli([
    "pipelines", "run",
    "--id", String(definitionId),
    "--branch", branchRef,
    "--parameters", `environment=${environment}`,
    "--org", activeOrg,
    "--project", activeProject,
    "--output", "json",
  ]);
  return JSON.parse(output);
}

/** List the projects ("businesses") in an org (defaults to the active org). */
async function listProjects(org = activeOrg) {
  const output = await execAzCli([
    "devops", "project", "list",
    "--org", org,
    "--output", "json",
  ]);
  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed) ? parsed : (parsed.value || []);
  return items
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Services are cached per (org, project, servicesUrl). Invalidated on any switch.
// A successful result is cached for SERVICES_TTL_MS; a failed one is not cached
// (at: 0) so the next call — or a manual refresh — retries immediately.
let servicesCache = { org: null, project: null, url: null, at: 0, services: [], warnings: [], error: null };
const SERVICES_TTL_MS = 60000;

/**
 * Pull the service list for the active project from the services.json — a hosted
 * URL or a local file. Shape: { "<business>": [ { name, buildPipelineId,
 * releasePipelineId }, ... ] }. Returns { services, warnings, error } — `error`
 * set (services empty) on any hard failure (offline, HTTP/read error, bad JSON,
 * business not in the file).
 */
async function servicesFromUrl(location) {
  const warnings = [];
  let data;
  try {
    data = await loadServicesDoc(location);
  } catch (err) {
    return { services: [], warnings, error: err.message };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { services: [], warnings, error: "The services file must be a JSON object keyed by business name." };
  }
  const list = data[activeProject];
  if (list === undefined) {
    const known = Object.keys(data);
    const hint = known.length ? ` Available: ${known.join(", ")}.` : "";
    return { services: [], warnings, error: `No services listed for business "${activeProject}" in the services file.${hint}` };
  }
  if (!Array.isArray(list)) {
    return { services: [], warnings, error: `The entry for "${activeProject}" in the services file must be an array.` };
  }
  const services = list
    .filter((s) => s && s.name && s.buildPipelineId && s.releasePipelineId)
    .map((s) => ({ name: String(s.name), buildPipelineId: s.buildPipelineId, releasePipelineId: s.releasePipelineId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const skipped = list.length - services.length;
  if (skipped > 0) {
    warnings.push(`${skipped} entr${skipped === 1 ? "y was" : "ies were"} skipped in the services file (missing name/buildPipelineId/releasePipelineId).`);
  }
  return { services, warnings, error: null };
}

/**
 * Resolve the service list for the active project from the hosted services.json.
 * The URL is the single source of truth — no URL means no services. Cached per
 * (org, project, url); force=true refetches.
 */
async function getServices(force = false) {
  const now = Date.now();
  if (!force && servicesCache.org === activeOrg && servicesCache.project === activeProject
      && servicesCache.url === activeServicesUrl && servicesCache.at
      && now - servicesCache.at < SERVICES_TTL_MS) {
    return servicesCache;
  }

  const { services, warnings, error } = activeServicesUrl
    ? await servicesFromUrl(activeServicesUrl)
    : { services: [], warnings: [], error: "No services URL configured — add one in Workspace settings." };

  servicesCache = {
    org: activeOrg,
    project: activeProject,
    url: activeServicesUrl,
    at: error ? 0 : now, // don't cache failures — retry on the next call
    services,
    warnings,
    error,
  };
  return servicesCache;
}

/** Resolve a service name to its `{ buildPipelineId, releasePipelineId }`, or null. */
async function resolveServiceIds(name) {
  const { services } = await getServices();
  const hit = services.find((s) => s.name === name);
  if (hit) return { buildPipelineId: hit.buildPipelineId, releasePipelineId: hit.releasePipelineId };
  return null;
}

/**
 * Poll a queued build/release until it completes.
 * Emits progress via onTick(build) so the UI can show elapsed seconds + status.
 * No time ceiling — keeps polling (60s initial, then 15s) until Azure reports
 * "completed" or the client disconnects (isAborted).
 */
async function pollUntilDone(buildId, onTick, isAborted = () => false) {
  const INITIAL_POLL_DELAY = 60000;
  const POLL_INTERVAL = 15000;
  const start = Date.now();

  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? INITIAL_POLL_DELAY : POLL_INTERVAL));
    if (isAborted()) return null; // client disconnected — stop polling Azure
    try {
      const build = await getBuild(buildId);
      const elapsed = Math.round((Date.now() - start) / 1000);
      if (onTick) onTick(build, elapsed);
      if (build.status === "completed") return build;
    } catch {
      // transient error — keep polling
    }
  }
}

// ---------------------------------------------------------------------------
// Deploy orchestration — one job = one service. Streams events via emit().
// ---------------------------------------------------------------------------

async function runJob(job, emit, isAborted = () => false) {
  const { service } = job;
  const branch = String(job.branch || "").trim();
  const environment = (job.environment || "dev").toLowerCase();
  const action = (job.action || "build-release").toLowerCase();
  const ids = await resolveServiceIds(service);

  const send = (phase, status, extra = {}) =>
    emit({ service, phase, status, ...extra });

  const doBuild = action === "build" || action === "build-release";
  const doRelease = action === "release" || action === "build-release";
  const firstPhase = doBuild ? "build" : "release";

  if (!ids) {
    send(firstPhase, "error", { message: `Unknown service "${service}".` });
    return { service, ok: false };
  }

  // The release runs from the SAME branch the user selected (so a build from
  // `june2` releases from `june2`), passing `environment` as the deploy target.
  // Production is the one exception: it stays pinned to `main` for safety.
  const ALLOWED_ENVS = ["dev", "testing", "staging", "production"];
  if (doRelease && !ALLOWED_ENVS.includes(environment)) {
    send(firstPhase, "error", { message: `Environment "${environment}" not allowed (dev, testing, staging, or production).` });
    return { service, ok: false };
  }
  const releaseBranch = environment === "production" ? "main" : (branch || "dev");

  // ---- BUILD ----
  if (doBuild) {
    if (branch.toLowerCase() === "master") {
      send("build", "error", { message: "Building from master is not allowed." });
      return { service, ok: false };
    }
    send("build", "queued", { branch });
    let build;
    try {
      build = await queuePipeline(ids.buildPipelineId, branch);
    } catch (err) {
      const msg = err.message.includes("validation errors")
        ? `Build validation failed — branch "${branch}" may not exist for this service.`
        : `Build trigger failed: ${err.message}`;
      send("build", "error", { message: msg });
      return { service, ok: false };
    }
    send("build", "running", { buildId: build.id, url: build._links?.web?.href });

    const finalBuild = await pollUntilDone(build.id, (bld, elapsed) =>
      send("build", "running", { buildId: build.id, elapsed, azStatus: bld.status }),
      isAborted
    );

    if (isAborted()) {
      // Stopped mid-build: the build keeps running in Azure, we just stop watching.
      send("build", "stopped", { buildId: build.id, message: "Stopped — build still running in Azure." });
      if (doRelease) send("release", "not-triggered", { message: "Not triggered — run stopped." });
      return { service, ok: false, aborted: true };
    }
    if (!finalBuild) {
      send("build", "error", { buildId: build.id, message: "Build polling stopped." + (doRelease ? " Release skipped." : "") });
      return { service, ok: false };
    }
    if (finalBuild.result !== "succeeded") {
      send("build", "failed", { buildId: build.id, result: finalBuild.result });
      if (doRelease) send("release", "skipped", { message: "Build did not succeed — release skipped." });
      return { service, ok: false };
    }
    send("build", "succeeded", { buildId: build.id });
  }

  // ---- RELEASE ---- (when building too, only reached after a successful build)
  if (doRelease) {
    if (isAborted()) { // stopped after the build, before the release was triggered
      send("release", "not-triggered", { message: "Not triggered — run stopped." });
      return { service, ok: false, aborted: true };
    }
    if (releaseBranch.toLowerCase() === "master") {
      send("release", "error", { message: "Releasing from master is not allowed." });
      return { service, ok: false };
    }
    send("release", "queued", { branch: releaseBranch, environment });
    let release;
    try {
      // environment is passed as a template parameter — this is what actually
      // selects dev/testing/staging/production (the branch alone defaults to dev).
      release = await queueRelease(ids.releasePipelineId, releaseBranch, environment);
    } catch (err) {
      send("release", "error", { message: `Release trigger failed: ${err.message}` });
      return { service, ok: false };
    }
    send("release", "running", { releaseId: release.id, url: release._links?.web?.href });

    const finalRelease = await pollUntilDone(release.id, (rel, elapsed) =>
      send("release", "running", { releaseId: release.id, elapsed, azStatus: rel.status }),
      isAborted
    );

    if (isAborted()) {
      // Stopped mid-release: the release keeps running in Azure, we just stop watching.
      send("release", "stopped", { releaseId: release.id, message: "Stopped — release still running in Azure." });
      return { service, ok: false, aborted: true };
    }
    if (!finalRelease) {
      send("release", "error", { releaseId: release.id, message: "Release polling stopped." });
      return { service, ok: false };
    }
    if (finalRelease.result !== "succeeded") {
      send("release", "failed", { releaseId: release.id, result: finalRelease.result });
      return { service, ok: false };
    }
    send("release", "succeeded", { releaseId: release.id });
  }

  return { service, ok: true };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "forbidden" });
  fs.readFile(full, (err, buf) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    const ext = path.extname(full);
    const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css"
      : ext === ".json" ? "application/json" : ext === ".mp3" ? "audio/mpeg"
      : ext === ".png" ? "image/png" : ext === ".ico" ? "image/x-icon" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(buf);
  });
}

// ---------------------------------------------------------------------------
// Run state — a deploy runs in the BACKGROUND (detached from any HTTP request),
// recording progress into `currentRun`. The page reads it via GET /api/status,
// so a browser refresh can reattach and keep showing the queued/running jobs.
// ---------------------------------------------------------------------------
let currentRun = null;
let runSeq = 0;

function startRun(jobs, opts = {}) {
  // Parallel only applies to single-phase actions (build-only / release-only),
  // where there's nothing to wait on between services. Build+Release always
  // runs sequentially so each build can finish before the next service starts.
  const singlePhase = jobs.every((j) => {
    const a = (j.action || "build-release").toLowerCase();
    return a === "build" || a === "release";
  });
  const parallel = singlePhase && opts.parallel === true;

  const run = {
    id: `run-${++runSeq}-${Date.now()}`,
    startedAt: Date.now(),
    jobs,                       // [{ service, branch, environment, action }]
    parallel,                   // whether services fire all-at-once
    progress: {},               // { service: { build:{...}, release:{...} } }
    status: "running",          // running | done | stopped
    result: null,               // { succeeded, failed, notTriggered }
    aborted: false,
  };
  currentRun = run;

  // Record events into run.progress (same shape the UI already renders).
  const emit = (evt) => {
    if (evt.service && evt.phase) {
      run.progress[evt.service] = run.progress[evt.service] || {};
      run.progress[evt.service][evt.phase] = {
        ...(run.progress[evt.service][evt.phase] || {}),
        ...evt,
      };
    }
  };
  const isAborted = () => run.aborted;

  const runOne = async (job) => {
    if (isAborted()) return { service: job.service, ok: false, aborted: true };
    return runJob(job, emit, isAborted);
  };

  // Mark a service that will never fire, so the UI shows "Not triggered" instead
  // of a blank card. Emitted on the phase the job would have started with.
  const markNotTriggered = (job, reason) => {
    const action = (job.action || "build-release").toLowerCase();
    const phase = action === "release" ? "release" : "build";
    emit({ service: job.service, phase, status: "not-triggered", message: `Not triggered — ${reason}.` });
  };

  // Fire-and-forget: the run continues regardless of who is (or isn't) watching.
  (async () => {
    let results;
    if (parallel) {
      // Parallel is single-phase only (build-only / release-only): everything is
      // launched at once, so there's no "not triggered" tail to halt.
      results = await Promise.all(jobs.map(runOne));
    } else {
      // Sequential (Build+Release): run one at a time and halt the rest the moment
      // a service is stopped or fails — the not-yet-started ones become "not triggered".
      results = [];
      let haltReason = null;
      for (const job of jobs) {
        if (isAborted()) haltReason = haltReason || "run stopped";
        if (haltReason) {
          markNotTriggered(job, haltReason);
          results.push({ service: job.service, ok: false, notTriggered: true });
          continue;
        }
        const r = await runOne(job);
        results.push(r);
        if (r && r.aborted) haltReason = "run stopped";
        else if (r && !r.ok) haltReason = "a prior build failed";
      }
    }
    run.result = {
      succeeded: results.filter((r) => r && r.ok).length,
      // The stopped-in-flight service (r.aborted) is neither succeeded, cleanly
      // failed, nor "not triggered" — its own card shows "Stopped".
      failed: results.filter((r) => r && !r.ok && !r.notTriggered && !r.aborted).length,
      notTriggered: results.filter((r) => r && r.notTriggered).length,
    };
    run.status = run.aborted ? "stopped" : "done";
  })().catch((e) => {
    run.status = "done";
    run.error = e.message;
  });

  return run;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // --- UI ---
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return serveStatic(res, "index.html");
    }

    // --- static assets (sounds, etc.) under public/ ---
    if (req.method === "GET" && !pathname.startsWith("/api/") && pathname !== "/") {
      return serveStatic(res, pathname.replace(/^\/+/, ""));
    }

    // --- list projects ("businesses") for an org (defaults to the active org) ---
    // The settings popup passes ?org=<typed url> to preview a different org before saving.
    if (req.method === "GET" && pathname === "/api/projects") {
      const org = (url.searchParams.get("org") || "").trim() || activeOrg;
      try {
        const projects = await listProjects(org);
        return sendJson(res, 200, { projects, org, activeOrg, activeProject, activeServicesUrl });
      } catch (err) {
        return sendJson(res, 200, { projects: [], org, activeOrg, activeProject, activeServicesUrl, error: err.message });
      }
    }

    // --- switch the active org + project; persist both ---
    if (req.method === "POST" && pathname === "/api/project") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const org = String(body.org || "").trim() || activeOrg;
      const project = String(body.project || "").trim();
      // servicesUrl is optional; omit the field to keep the current one, or send
      // "" to clear it (no services). May be an http(s) URL or a local file path.
      const servicesUrl = body.servicesUrl !== undefined ? String(body.servicesUrl).trim() : activeServicesUrl;
      if (!org) return sendJson(res, 400, { error: "org is required" });
      if (!project) return sendJson(res, 400, { error: "project is required" });
      if (servicesUrl && !isValidServicesLocation(servicesUrl)) {
        return sendJson(res, 400, { error: "Enter an http(s) URL or an absolute path to a .json file." });
      }
      if (currentRun && currentRun.status === "running") {
        return sendJson(res, 409, { error: "A run is in progress — stop it before switching workspace." });
      }
      // Validate the project exists in the (possibly new) org.
      try {
        const projects = await listProjects(org);
        if (projects.length && !projects.some((p) => p.name === project)) {
          return sendJson(res, 400, { error: `Business "${project}" not found in this org.` });
        }
      } catch (err) {
        return sendJson(res, 400, { error: `Could not reach org "${org}": ${err.message}` });
      }
      activeOrg = org;
      activeProject = project;
      activeServicesUrl = servicesUrl;
      servicesCache = { org: null, project: null, url: null, at: 0, services: [], warnings: [], error: null }; // invalidate
      try {
        setConfig("AZURE_DEVOPS_ORG", org);
        setConfig("AZURE_DEVOPS_PROJECT", project);
        setConfig("SERVICES_URL", servicesUrl);
      } catch { /* persistence is best-effort */ }
      return sendJson(res, 200, { ok: true, activeOrg, activeProject, activeServicesUrl });
    }

    // --- list services for the active project (from the hosted services.json) ---
    if (req.method === "GET" && pathname === "/api/services") {
      const force = url.searchParams.get("refresh") === "1";
      const { services, warnings, error } = await getServices(force);
      return sendJson(res, 200, {
        services,
        defaultBranches: DEFAULT_BRANCHES,
        project: activeProject,
        warnings,
        error,
      });
    }

    // --- live branch list for a service ---
    if (req.method === "GET" && pathname === "/api/branches") {
      const service = url.searchParams.get("service");
      const ids = await resolveServiceIds(service);
      if (!ids) return sendJson(res, 404, { error: `Unknown service "${service}".` });
      try {
        const repo = await getPipelineRepository(ids.buildPipelineId);
        const repoRef = repo.id || repo.name;
        if (!repoRef) throw new Error("could not determine repository for this pipeline");
        let branches = await listBranches(repoRef);
        // Pin the common defaults to the top, then the rest alphabetically.
        const rest = branches.filter((b) => !DEFAULT_BRANCHES.includes(b)).sort();
        const pinned = DEFAULT_BRANCHES.filter((b) => branches.includes(b));
        return sendJson(res, 200, { repository: repo.name, branches: [...pinned, ...rest] });
      } catch (err) {
        // Surface the error but still hand back the defaults so the dropdown works.
        return sendJson(res, 200, { repository: null, branches: DEFAULT_BRANCHES, warning: err.message });
      }
    }

    // --- deploy: start a background run, return its id immediately ---
    if (req.method === "POST" && pathname === "/api/deploy") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const jobs = Array.isArray(body.jobs) ? body.jobs : [];
      if (jobs.length === 0) return sendJson(res, 400, { error: "no jobs provided" });
      if (currentRun && currentRun.status === "running") {
        return sendJson(res, 409, { error: "A run is already in progress.", run: currentRun });
      }
      const run = startRun(jobs, { parallel: body.parallel === true });
      return sendJson(res, 200, { runId: run.id, run });
    }

    // --- status: snapshot of the current/last run (used to reattach on refresh) ---
    if (req.method === "GET" && pathname === "/api/status") {
      return sendJson(res, 200, { run: currentRun });
    }

    // --- credential vault: read + save the whole document ---
    if (req.method === "GET" && pathname === "/api/credentials") {
      return sendJson(res, 200, readCredentials());
    }
    if (req.method === "PUT" && pathname === "/api/credentials") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!Array.isArray(body.groups)) return sendJson(res, 400, { error: "expected { groups: [...] }" });
      try {
        writeCredentials({ groups: body.groups });
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 500, { error: `Could not save: ${err.message}` });
      }
    }

    // --- ONDC search proxy: forwards the payload to the ONDC core endpoint ---
    if (req.method === "POST" && pathname === "/api/ondc-search") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const target = ONDC_URLS[body.env];
      if (!target) return sendJson(res, 400, { error: `Unknown ONDC env "${body.env}" (dev, test, or prod).` });
      if (!body.payload || typeof body.payload !== "object") return sendJson(res, 400, { error: "missing payload" });
      const startedAt = Date.now();
      try {
        const { status, body: respBody } = await httpsPostJson(target, body.payload);
        return sendJson(res, 200, { ok: status >= 200 && status < 300, status, body: respBody, elapsed: Date.now() - startedAt });
      } catch (err) {
        return sendJson(res, 502, { error: `ONDC request failed: ${err.message}`, elapsed: Date.now() - startedAt });
      }
    }

    // --- stop: abort the in-progress run (no further services are triggered) ---
    if (req.method === "POST" && pathname === "/api/stop") {
      if (currentRun && currentRun.status === "running") {
        currentRun.aborted = true;
        return sendJson(res, 200, { ok: true, run: currentRun });
      }
      return sendJson(res, 200, { ok: false, message: "no run in progress" });
    }

    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  const orgInfo = activeOrg ? "" : "  (warning: Azure DevOps org/project not configured — set it in Workspace settings)";
  console.log(`\n  Build & Release UI running at  http://localhost:${PORT}${orgInfo}\n`);
});

module.exports = { server };
