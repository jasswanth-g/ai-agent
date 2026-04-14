const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function listReleases({ name } = {}) {
  const args = [
    "pipelines", "release", "definition", "list",
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const definitions = JSON.parse(output);

  let filtered = definitions;
  if (name) {
    const nameLower = name.toLowerCase();
    filtered = definitions.filter((d) =>
      d.name.toLowerCase().includes(nameLower)
    );
  }

  if (!filtered.length) return "No release definitions found.";

  return filtered
    .map((d) => `ID: ${d.id} | Name: ${d.name}`)
    .join("\n");
}

module.exports = {
  name: "az_list_releases",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Partial name to filter release definitions" },
    },
    required: [],
  },
  description:
    'List release definitions. Optional args: {"name": "partial-name"} to filter.',
  fn: async (args) => {
    try {
      return await listReleases(args);
    } catch (e) {
      return `Error listing releases: ${e.message}`;
    }
  },
};
