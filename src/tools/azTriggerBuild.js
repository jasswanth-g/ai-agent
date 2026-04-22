const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");
const chalk = require("chalk");
const ora = require("ora");

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

async function pollBuild(buildId) {
  const spinner = ora({
    text: chalk.yellow(`Build #${buildId} in progress...`),
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
      spinner.text = chalk.yellow(`Build #${buildId} — ${build.status} (${elapsed}s)`);

      if (build.status === "completed") {
        if (build.result === "succeeded") {
          spinner.succeed(chalk.green(`Build #${buildId} succeeded!`) + chalk.gray(` (${elapsed}s)`));
        } else {
          spinner.fail(chalk.red(`Build #${buildId} ${build.result}`) + chalk.gray(` (${elapsed}s)`));
        }
        return build;
      }
    } catch {
      // ignore transient errors, keep polling
    }
  }

  spinner.warn(chalk.yellow(`Build #${buildId} still running after 5 minutes. Check manually.`));
  return null;
}

async function triggerBuild({ pipeline_id, branch, wait_for_completion }) {
  if (!pipeline_id) return "Error: pipeline_id is required.";
  if (!branch) return "Error: branch is required.";

  if (!/^\d+$/.test(String(pipeline_id))) {
    return "Error: pipeline_id must be a number.";
  }

  if (["main", "master"].includes(branch.toLowerCase().replace("refs/heads/", ""))) {
    return "Error: Triggering builds from main/master is not allowed through this agent.";
  }

  const branchPattern = /^[a-zA-Z0-9/_.\-]+$/;
  if (!branchPattern.test(branch)) {
    return "Error: branch name contains invalid characters.";
  }

  const branchRef = branch.startsWith("refs/heads/")
    ? branch
    : `refs/heads/${branch}`;

  const args = [
    "pipelines", "build", "queue",
    "--definition-id", String(pipeline_id),
    "--branch", branchRef,
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  let output;
  try {
    output = await execAzCli(args);
  } catch (err) {
    if (err.message.includes("validation errors")) {
      return `Error: Build validation failed. The branch "${branch}" may not exist in this repository. Please verify the branch name and service.`;
    }
    throw err;
  }
  const build = JSON.parse(output);

  // Wait for build to complete (used when release follows)
  if (wait_for_completion === "true" || wait_for_completion === true) {
    const finalBuild = await pollBuild(build.id);
    if (!finalBuild) {
      return [
        `Build queued but timed out waiting for completion.`,
        `Build ID: ${build.id}`,
        `URL: ${build._links?.web?.href || "N/A"}`,
        `Result: TIMEOUT — check manually before releasing.`,
      ].join("\n");
    }
    return [
      `Build ID: ${finalBuild.id}`,
      `Status: ${finalBuild.status}`,
      `Result: ${finalBuild.result}`,
      `URL: ${build._links?.web?.href || "N/A"}`,
      finalBuild.result === "succeeded"
        ? "BUILD SUCCEEDED — safe to release."
        : "BUILD FAILED — do NOT release.",
    ].join("\n");
  }

  // Fire and forget — poll in background
  pollBuild(build.id).catch(() => {});

  return [
    `Build queued successfully!`,
    `Build ID: ${build.id}`,
    `Status: ${build.status}`,
    `URL: ${build._links?.web?.href || "N/A"}`,
  ].join("\n");
}

module.exports = {
  name: "az_trigger_build",
  input_schema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string", description: "Build pipeline ID" },
      branch: { type: "string", description: "Branch name to build from" },
      wait_for_completion: { type: "string", description: "Set to 'true' to wait for build to finish before returning" },
    },
    required: ["pipeline_id", "branch"],
  },
  description:
    'Queue a build pipeline on a branch. You MUST pass the buildPipelineId returned by az_resolve_service for THIS request — do NOT reuse IDs from examples or prior calls. Args: {"pipeline_id": "<buildPipelineId from az_resolve_service>", "branch": "<branch>", "wait_for_completion": "true"}. Set wait_for_completion to "true" when a release will follow — it waits for the build to finish and reports success/failure.',
  fn: async (args) => {
    try {
      return await triggerBuild(args);
    } catch (e) {
      return `Error triggering build: ${e.message}`;
    }
  },
};
