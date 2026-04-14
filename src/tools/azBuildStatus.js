const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function buildStatus({ build_id }) {
  if (!build_id) return "Error: build_id is required.";

  if (!/^\d+$/.test(String(build_id))) {
    return "Error: build_id must be a number.";
  }

  const args = [
    "pipelines", "build", "show",
    "--id", String(build_id),
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const build = JSON.parse(output);

  return [
    `Build ID: ${build.id}`,
    `Pipeline: ${build.definition?.name || "N/A"}`,
    `Status: ${build.status}`,
    `Result: ${build.result || "in progress"}`,
    `Source Branch: ${build.sourceBranch}`,
    `Start Time: ${build.startTime || "not started"}`,
    `Finish Time: ${build.finishTime || "not finished"}`,
    `URL: ${build._links?.web?.href || "N/A"}`,
  ].join("\n");
}

module.exports = {
  name: "az_build_status",
  input_schema: {
    type: "object",
    properties: {
      build_id: { type: "string", description: "Build ID to check" },
    },
    required: ["build_id"],
  },
  description:
    'Check the status of a build. Args: {"build_id": "456"}',
  fn: async (args) => {
    try {
      return await buildStatus(args);
    } catch (e) {
      return `Error checking build status: ${e.message}`;
    }
  },
};
