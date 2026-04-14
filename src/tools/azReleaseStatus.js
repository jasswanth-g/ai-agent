const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function releaseStatus({ release_id }) {
  if (!release_id) return "Error: release_id is required.";

  if (!/^\d+$/.test(String(release_id))) {
    return "Error: release_id must be a number.";
  }

  const args = [
    "pipelines", "release", "show",
    "--id", String(release_id),
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const release = JSON.parse(output);

  const environments = (release.environments || [])
    .map((env) => `  ${env.name}: ${env.status}`)
    .join("\n");

  return [
    `Release ID: ${release.id}`,
    `Name: ${release.name}`,
    `Status: ${release.status}`,
    `Environments:`,
    environments || "  (none)",
    `URL: ${release._links?.web?.href || "N/A"}`,
  ].join("\n");
}

module.exports = {
  name: "az_release_status",
  input_schema: {
    type: "object",
    properties: {
      release_id: { type: "string", description: "Release ID to check" },
    },
    required: ["release_id"],
  },
  description:
    'Check status of a release and its stages. Args: {"release_id": "101"}',
  fn: async (args) => {
    try {
      return await releaseStatus(args);
    } catch (e) {
      return `Error checking release status: ${e.message}`;
    }
  },
};
