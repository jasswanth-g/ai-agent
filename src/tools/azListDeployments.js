const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function listDeployments({ definition_id, top } = {}) {
  if (!definition_id) return "Error: definition_id (release pipeline ID) is required.";

  // ArgoCD release pipelines are build pipelines in Azure DevOps,
  // so we use "pipelines build list" not "pipelines release list"
  const args = [
    "pipelines", "build", "list",
    "--definition-ids", String(definition_id),
    "--top", String(top || 5),
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const builds = JSON.parse(output);

  if (!builds.length) return "No releases/deployments found for this pipeline.";

  return builds
    .map((b) => [
      `Release ID: ${b.id}`,
      `Pipeline: ${b.definition?.name || "N/A"}`,
      `Status: ${b.status}`,
      `Result: ${b.result || "in progress"}`,
      `Branch: ${b.sourceBranch?.replace("refs/heads/", "") || "N/A"}`,
      `Requested by: ${b.requestedBy?.displayName || b.requestedFor?.displayName || "Unknown"}`,
      `Start: ${b.startTime || "N/A"}`,
      `Finish: ${b.finishTime || "N/A"}`,
    ].join(" | "))
    .join("\n---\n");
}

module.exports = {
  name: "az_list_deployments",
  input_schema: {
    type: "object",
    properties: {
      definition_id: { type: "string", description: "Release/ArgoCD pipeline ID" },
      top: { type: "string", description: "Number of releases to return (default 5)" },
    },
    required: ["definition_id"],
  },
  description:
    'List recent releases/deployments for a service. Args: {"definition_id": "193"} (the releasePipelineId from az_resolve_service). Optional: {"top": "5"}',
  fn: async (args) => {
    try {
      return await listDeployments(args);
    } catch (e) {
      return `Error listing deployments: ${e.message}`;
    }
  },
};
