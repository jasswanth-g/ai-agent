const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");
const { SERVICE_ALIASES } = require("../config/serviceAliases");
const chalk = require("chalk");
const ora = require("ora");

function normalizeName(name) {
  return String(name || "").toLowerCase().trim().replace(/[\s_]+/g, "-");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function resolveAlias(name) {
  const norm = normalizeName(name);
  if (SERVICE_ALIASES[norm]) {
    return { canonical: norm, ids: SERVICE_ALIASES[norm] };
  }
  const aliases = Object.keys(SERVICE_ALIASES);
  const scored = aliases
    .map((alias) => ({ alias, distance: levenshtein(norm, alias) }))
    .sort((a, b) => a.distance - b.distance);
  const best = scored[0];
  if (best && best.distance <= Math.max(2, Math.ceil(norm.length * 0.3))) {
    return { canonical: best.alias, ids: SERVICE_ALIASES[best.alias] };
  }
  return { canonical: null, suggestions: scored.slice(0, 3).map((s) => s.alias) };
}

async function getBuildStatus(buildId) {
  const args = [
    "pipelines", "build", "show",
    "--id", String(buildId),
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];
  const output = await execAzCli(args);
  return JSON.parse(output);
}

async function pollBuild(buildId, label) {
  const spinner = ora({
    text: chalk.yellow(`${label} #${buildId} in progress...`),
    color: "yellow",
  }).start();

  const INITIAL_POLL_DELAY = 60000; // builds rarely finish under 60s — skip early polls
  const POLL_INTERVAL = 15000;
  const MAX_POLLS = 17; // 60s + 16 × 15s = 300s = 5 min ceiling
  const startTime = Date.now();

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? INITIAL_POLL_DELAY : POLL_INTERVAL));
    try {
      const build = await getBuildStatus(buildId);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      spinner.text = chalk.yellow(`${label} #${buildId} — ${build.status} (${elapsed}s)`);

      if (build.status === "completed") {
        if (build.result === "succeeded") {
          spinner.succeed(chalk.green(`${label} #${buildId} succeeded!`) + chalk.gray(` (${elapsed}s)`));
        } else {
          spinner.fail(chalk.red(`${label} #${buildId} ${build.result}`) + chalk.gray(` (${elapsed}s)`));
        }
        return build;
      }
    } catch {}
  }

  spinner.warn(chalk.yellow(`${label} #${buildId} still running after 5 minutes.`));
  return null;
}

async function buildAndReleaseOne({ canonical, ids, branch, env }) {
  const releaseBranch = (env === "test") ? "testing" : "dev";
  const buildBranchRef = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  const releaseBranchRef = `refs/heads/${releaseBranch}`;

  let build;
  try {
    const output = await execAzCli([
      "pipelines", "build", "queue",
      "--definition-id", String(ids.buildPipelineId),
      "--branch", buildBranchRef,
      "--org", AZURE_DEVOPS_ORG,
      "--project", AZURE_DEVOPS_PROJECT,
      "--output", "json",
    ]);
    build = JSON.parse(output);
  } catch (err) {
    const msg = err.message.includes("validation errors")
      ? `build validation failed (branch "${branch}" may not exist)`
      : `build trigger failed: ${err.message}`;
    return { canonical, ok: false, error: msg };
  }

  const finalBuild = await pollBuild(build.id, `${canonical} build`);
  if (!finalBuild) {
    return { canonical, ok: false, buildId: build.id, error: `build #${build.id} timed out. Release skipped.` };
  }
  if (finalBuild.result !== "succeeded") {
    return { canonical, ok: false, buildId: build.id, error: `build #${build.id} ${finalBuild.result}. Release skipped.` };
  }

  const releaseSpinner = ora({
    text: chalk.yellow(`${canonical}: triggering release...`),
    color: "yellow",
  }).start();

  let release;
  try {
    const output = await execAzCli([
      "pipelines", "build", "queue",
      "--definition-id", String(ids.releasePipelineId),
      "--branch", releaseBranchRef,
      "--org", AZURE_DEVOPS_ORG,
      "--project", AZURE_DEVOPS_PROJECT,
      "--output", "json",
    ]);
    release = JSON.parse(output);
    releaseSpinner.succeed(chalk.green(`${canonical}: release triggered!`));
  } catch (err) {
    releaseSpinner.fail(chalk.red(`${canonical}: release trigger failed`));
    return { canonical, ok: false, buildId: build.id, error: `release trigger failed: ${err.message}` };
  }

  const finalRelease = await pollBuild(release.id, `${canonical} release`);
  if (!finalRelease) {
    return { canonical, ok: false, buildId: build.id, releaseId: release.id, error: `release #${release.id} timed out` };
  }
  if (finalRelease.result !== "succeeded") {
    return { canonical, ok: false, buildId: build.id, releaseId: release.id, error: `release #${release.id} ${finalRelease.result}` };
  }

  return {
    canonical,
    ok: true,
    buildId: build.id,
    releaseId: release.id,
    pipelineName: release.definition?.name || "N/A",
  };
}

async function buildAndRelease({ service_names, service_name, branch, environment }) {
  // Accept service_names (array or comma-separated string) OR legacy service_name (string).
  let names = [];
  if (Array.isArray(service_names)) {
    names = service_names;
  } else if (typeof service_names === "string" && service_names.trim()) {
    names = service_names.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (service_name) {
    names = [service_name];
  }
  names = names.map((n) => String(n).trim()).filter(Boolean);

  if (names.length === 0) return "Error: service_names is required (pass an array, even for a single service).";
  if (!branch) return "Error: branch is required.";

  if (["main", "master"].includes(branch.toLowerCase())) {
    return "Error: Triggering builds from main/master is not allowed through this agent.";
  }

  const env = (environment || "dev").toLowerCase();
  if (env !== "dev" && env !== "test") {
    return `Error: Environment "${environment}" is not allowed. Only dev and test are permitted.`;
  }

  // Resolve every name up front. If any are unknown, abort before triggering anything.
  const resolved = names.map((name) => ({ input: name, ...resolveAlias(name) }));
  const unknown = resolved.filter((r) => !r.canonical);
  if (unknown.length > 0) {
    const lines = unknown.map((u) => `  - "${u.input}" (did you mean: ${(u.suggestions || []).join(", ") || "no match"}?)`);
    return [
      `Error: ${unknown.length} unknown service${unknown.length > 1 ? "s" : ""}. Nothing was triggered.`,
      ...lines,
      `Fix the names and retry.`,
    ].join("\n");
  }

  // De-duplicate after canonicalization (preserve original order).
  const seen = new Set();
  const unique = [];
  for (const r of resolved) {
    if (!seen.has(r.canonical)) {
      seen.add(r.canonical);
      unique.push(r);
    }
  }

  // Single-service: preserve the original output format.
  if (unique.length === 1) {
    const r = unique[0];
    const res = await buildAndReleaseOne({ canonical: r.canonical, ids: r.ids, branch, env });
    if (!res.ok) {
      return res.buildId
        ? `Build #${res.buildId} ${res.error.includes("timed") ? "timed out" : "did not succeed"}. ${res.error}`
        : `${res.canonical}: ${res.error}`;
    }
    return [
      `Build #${res.buildId} succeeded.`,
      `Release #${res.releaseId} succeeded!`,
      `Pipeline: ${res.pipelineName}`,
      `Branch: ${env === "test" ? "testing" : "dev"}`,
      `Environment: ${env}`,
    ].join("\n");
  }

  // Multi-service: run sequentially, keep per-service status, report a summary.
  const total = unique.length;
  const results = [];
  for (let i = 0; i < total; i++) {
    const r = unique[i];
    console.log(chalk.bold.cyan(`\n[${i + 1}/${total}] ${r.canonical}`));
    const res = await buildAndReleaseOne({ canonical: r.canonical, ids: r.ids, branch, env });
    results.push(res);
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = total - succeeded;

  const lines = [
    ``,
    `=== Build & Release Summary ===`,
    `Total: ${total}   Succeeded: ${succeeded}   Failed: ${failed}`,
    `Branch: ${branch}   Environment: ${env}`,
    ``,
  ];
  for (const r of results) {
    if (r.ok) {
      lines.push(`  ✔ ${r.canonical}: build #${r.buildId} & release #${r.releaseId} succeeded`);
    } else {
      lines.push(`  ✖ ${r.canonical}: ${r.error}`);
    }
  }
  return lines.join("\n");
}

module.exports = {
  name: "az_build_and_release",
  input_schema: {
    type: "object",
    properties: {
      service_names: {
        type: "array",
        items: { type: "string" },
        description: "Array of service names (e.g. ['pre-order-service', 'partner-portal']). Pass a one-element array even for a single service. Spaces and underscores are auto-normalized to hyphens.",
      },
      branch: { type: "string", description: "Branch to build from (e.g. dev, testing). main/master not allowed." },
      environment: { type: "string", description: "Target environment: dev or test (defaults to dev)" },
    },
    required: ["service_names", "branch"],
  },
  description:
    'Build and release one or more services. Pass service_names as an ARRAY — a single service is a one-element array. The tool validates all names first (spaces → hyphens, fuzzy-matches typos), then runs build+release sequentially per service. If any name is unknown, nothing is triggered. Args: {"service_names": ["<service>", ...], "branch": "<branch>", "environment": "<dev|test>"}',
  fn: async (args) => {
    try {
      return await buildAndRelease(args);
    } catch (e) {
      return `Error in build and release: ${e.message}`;
    }
  },
};
