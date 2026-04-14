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

  const POLL_INTERVAL = 15000;
  const MAX_POLLS = 80;
  const startTime = Date.now();

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
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
    } catch {}
  }

  spinner.warn(chalk.yellow(`Build #${buildId} still running after 20 minutes.`));
  return null;
}

async function buildAndRelease({ build_pipeline_id, release_pipeline_id, branch, environment }) {
  if (!build_pipeline_id) return "Error: build_pipeline_id is required.";
  if (!release_pipeline_id) return "Error: release_pipeline_id is required.";
  if (!branch) return "Error: branch is required.";

  if (["main", "master"].includes(branch.toLowerCase())) {
    return "Error: Triggering builds from main/master is not allowed through this agent.";
  }

  const env = (environment || "dev").toLowerCase();
  if (env !== "dev" && env !== "test") {
    return `Error: Environment "${environment}" is not allowed. Only dev and test are permitted.`;
  }

  const releaseBranch = (env === "test") ? "testing" : "dev";
  const buildBranchRef = branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
  const releaseBranchRef = `refs/heads/${releaseBranch}`;

  // Step 1: Trigger build
  const buildArgs = [
    "pipelines", "build", "queue",
    "--definition-id", String(build_pipeline_id),
    "--branch", buildBranchRef,
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  let buildOutput;
  try {
    buildOutput = await execAzCli(buildArgs);
  } catch (err) {
    if (err.message.includes("validation errors")) {
      return `Error: Build validation failed. The branch "${branch}" may not exist in this repository. Please verify the branch name and service.`;
    }
    throw err;
  }
  const build = JSON.parse(buildOutput);

  // Step 2: Wait for build to complete
  const finalBuild = await pollBuild(build.id);

  if (!finalBuild) {
    return `Build #${build.id} timed out. Release was NOT triggered. Check the build manually.`;
  }

  if (finalBuild.result !== "succeeded") {
    return `Build #${build.id} ${finalBuild.result}. Release was NOT triggered.`;
  }

  // Step 3: Trigger release
  const releaseSpinner = ora({
    text: chalk.yellow("Triggering release..."),
    color: "yellow",
  }).start();

  const releaseArgs = [
    "pipelines", "build", "queue",
    "--definition-id", String(release_pipeline_id),
    "--branch", releaseBranchRef,
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const releaseOutput = await execAzCli(releaseArgs);
  const release = JSON.parse(releaseOutput);
  releaseSpinner.succeed(chalk.green("Release triggered!"));

  // Step 4: Wait for release to complete
  const finalRelease = await pollBuild(release.id);

  if (!finalRelease) {
    return [
      `Build #${build.id} succeeded.`,
      `Release #${release.id} triggered but timed out waiting for completion.`,
      `Check the release status manually.`,
    ].join("\n");
  }

  if (finalRelease.result !== "succeeded") {
    return [
      `Build #${build.id} succeeded.`,
      `Release #${release.id} ${finalRelease.result}.`,
      `Environment: ${env}`,
    ].join("\n");
  }

  return [
    `Build #${build.id} succeeded.`,
    `Release #${release.id} succeeded!`,
    `Pipeline: ${release.definition?.name || "N/A"}`,
    `Branch: ${releaseBranch}`,
    `Environment: ${env}`,
  ].join("\n");
}

module.exports = {
  name: "az_build_and_release",
  input_schema: {
    type: "object",
    properties: {
      build_pipeline_id: { type: "string", description: "Build pipeline ID from az_resolve_service" },
      release_pipeline_id: { type: "string", description: "Release pipeline ID from az_resolve_service" },
      branch: { type: "string", description: "Branch to build from (e.g. dev, testing). main/master not allowed." },
      environment: { type: "string", description: "Target environment: dev or test (defaults to dev)" },
    },
    required: ["build_pipeline_id", "release_pipeline_id", "branch"],
  },
  description:
    'Build and release a service in one step. Triggers the build, waits for it to succeed, then triggers the release. If build fails, release is NOT triggered. Use this when user asks for both build AND release together. Args: {"build_pipeline_id": "192", "release_pipeline_id": "193", "branch": "dev", "environment": "dev"}',
  fn: async (args) => {
    try {
      return await buildAndRelease(args);
    } catch (e) {
      return `Error in build and release: ${e.message}`;
    }
  },
};
