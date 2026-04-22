const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

const ALLOWED_ENVIRONMENTS = ["dev", "test"];

async function triggerRelease({ definition_id, environment, branch, artifact_version }) {
  if (!definition_id) return "Error: definition_id is required.";
  if (!/^\d+$/.test(String(definition_id))) {
    return "Error: definition_id must be a number.";
  }

  const releaseBranch = (branch || "dev").toLowerCase();
  if (releaseBranch === "main" || releaseBranch === "master") {
    return "Error: Releasing from main/master is not allowed through this agent.";
  }

  // Default to dev, only allow dev and test
  const env = (environment || "dev").toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.includes(env)) {
    return `Error: Environment "${environment}" is not allowed. Only dev and test are permitted through this agent. For prod deployments, use the Azure DevOps portal.`;
  }

  // ArgoCD release pipelines are actually build pipelines in Azure DevOps.
  // We trigger them using "az pipelines build queue" not "az pipelines release create".
  const branchRef = `refs/heads/${releaseBranch}`;

  const args = [
    "pipelines", "build", "queue",
    "--definition-id", String(definition_id),
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  args.push("--branch", branchRef);

  const output = await execAzCli(args);
  const build = JSON.parse(output);

  return [
    `Release triggered successfully!`,
    `Release Build ID: ${build.id}`,
    `Pipeline: ${build.definition?.name || "N/A"}`,
    `Status: ${build.status}`,
    `Environment: ${env}`,
    `URL: ${build._links?.web?.href || "N/A"}`,
  ].join("\n");
}

module.exports = {
  name: "az_trigger_release",
  input_schema: {
    type: "object",
    properties: {
      definition_id: { type: "string", description: "Release/ArgoCD pipeline ID" },
      branch: { type: "string", description: "Branch to release from. Only 'dev' or 'testing' allowed. Defaults to 'dev'." },
      environment: { type: "string", description: "Target environment: dev or test (defaults to dev)" },
      artifact_version: { type: "string", description: "Build ID to use as artifact" },
    },
    required: ["definition_id"],
  },
  description:
    'Trigger a release/deployment via ArgoCD pipeline. You MUST pass the releasePipelineId returned by az_resolve_service for THIS request — do NOT reuse IDs from examples or prior calls. Args: {"definition_id": "<releasePipelineId from az_resolve_service>", "branch": "<branch>", "environment": "<dev|test>"}. Branch defaults to "dev", only "dev" and "testing" are allowed. Environment defaults to "dev", only "dev" and "test" allowed.',
  fn: async (args) => {
    try {
      return await triggerRelease(args);
    } catch (e) {
      return `Error triggering release: ${e.message}`;
    }
  },
};
