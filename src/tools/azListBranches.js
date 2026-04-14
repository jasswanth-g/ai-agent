const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function listBranches({ repository }) {
  if (!repository) return "Error: repository name is required.";

  const args = [
    "repos", "ref", "list",
    "--repository", repository,
    "--filter", "heads/",
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const refs = JSON.parse(output);

  if (!refs.length) return "No branches found.";

  return refs
    .map((r) => r.name.replace("refs/heads/", ""))
    .join("\n");
}

module.exports = {
  name: "az_list_branches",
  input_schema: {
    type: "object",
    properties: {
      repository: { type: "string", description: "Repository name" },
    },
    required: ["repository"],
  },
  description:
    'List branches in a repository. Args: {"repository": "repo-name"}',
  fn: async (args) => {
    try {
      return await listBranches(args);
    } catch (e) {
      return `Error listing branches: ${e.message}`;
    }
  },
};
