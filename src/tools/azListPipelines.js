const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function listPipelines({ name } = {}) {
  const args = [
    "pipelines", "list",
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];
  if (name) {
    args.push("--name", name);
  }

  const output = await execAzCli(args);
  const pipelines = JSON.parse(output);

  if (!pipelines.length) return "No pipelines found.";

  return pipelines
    .map((p) => `ID: ${p.id} | Name: ${p.name} | Path: ${p.path || "/"}`)
    .join("\n");
}

module.exports = {
  name: "az_list_pipelines",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Partial name to filter pipelines" },
    },
    required: [],
  },
  description:
    'List available build pipelines. Optional args: {"name": "partial-name"} to filter.',
  fn: async (args) => {
    try {
      return await listPipelines(args);
    } catch (e) {
      return `Error listing pipelines: ${e.message}`;
    }
  },
};
