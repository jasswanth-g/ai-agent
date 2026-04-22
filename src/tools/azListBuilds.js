const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function listBuilds({ pipeline_id, top, branch } = {}) {
  const args = [
    "pipelines", "runs", "list",
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  if (pipeline_id) {
    args.push("--pipeline-ids", String(pipeline_id));
  }
  if (branch) {
    const branchRef = branch.startsWith("refs/heads/")
      ? branch
      : `refs/heads/${branch}`;
    args.push("--branch", branchRef);
  }
  args.push("--top", String(top || 10));

  const output = await execAzCli(args);
  const builds = JSON.parse(output);

  if (!builds.length) return "No builds found.";

  return builds
    .map((b) => [
      `Build ID: ${b.id}`,
      `  Pipeline: ${b.definition?.name || "N/A"}`,
      `  Status: ${b.status} | Result: ${b.result || "in progress"}`,
      `  Source Branch: ${b.sourceBranch}`,
      `  Requested By: ${b.requestedBy?.displayName || b.requestedFor?.displayName || "N/A"}`,
      `  Start: ${b.startTime || "N/A"} | Finish: ${b.finishTime || "N/A"}`,
    ].join("\n"))
    .join("\n---\n");
}

module.exports = {
  name: "az_list_builds",
  input_schema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string", description: "Build pipeline ID" },
      top: { type: "string", description: "Number of builds to return (default 5)" },
      branch: { type: "string", description: "Filter by branch name" },
    },
    required: [],
  },
  description:
    'List recent builds/runs. Optional args: {"pipeline_id": "123", "top": "5", "branch": "main"}',
  fn: async (args) => {
    try {
      return await listBuilds(args);
    } catch (e) {
      return `Error listing builds: ${e.message}`;
    }
  },
};
