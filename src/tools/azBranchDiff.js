const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

async function branchDiff({ repository, source_branch, target_branch }) {
  if (!repository) return "Error: repository is required.";
  if (!source_branch) return "Error: source_branch is required.";
  if (!target_branch) return "Error: target_branch is required.";

  // Get commits in source that are not in target
  const args = [
    "repos", "pr", "list",
    "--repository", repository,
    "--source-branch", source_branch,
    "--target-branch", target_branch,
    "--status", "all",
    "--top", "10",
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  // Also get the diff using git diff via Azure API
  const diffArgs = [
    "devops", "invoke",
    "--area", "git",
    "--resource", "diffs",
    "--route-parameters",
    `project=${AZURE_DEVOPS_PROJECT}`,
    `repositoryId=${repository}`,
    "--query-parameters",
    `baseVersion=${target_branch}`,
    `targetVersion=${source_branch}`,
    `baseVersionType=branch`,
    `targetVersionType=branch`,
    "--org", AZURE_DEVOPS_ORG,
    "--output", "json",
  ];

  let diffResult;
  try {
    const output = await execAzCli(diffArgs);
    diffResult = JSON.parse(output);
  } catch (e) {
    // Fallback: try listing commits difference
    try {
      const commitArgs = [
        "repos", "ref", "list",
        "--repository", repository,
        "--filter", "heads/",
        "--org", AZURE_DEVOPS_ORG,
        "--project", AZURE_DEVOPS_PROJECT,
        "--output", "json",
      ];
      const refOutput = await execAzCli(commitArgs);
      const refs = JSON.parse(refOutput);

      const sourceSha = refs.find((r) => r.name === `refs/heads/${source_branch}`)?.objectId;
      const targetSha = refs.find((r) => r.name === `refs/heads/${target_branch}`)?.objectId;

      if (!sourceSha) return `Error: Branch "${source_branch}" not found in ${repository}.`;
      if (!targetSha) return `Error: Branch "${target_branch}" not found in ${repository}.`;

      if (sourceSha === targetSha) {
        return `Branches "${source_branch}" and "${target_branch}" are identical (same commit: ${sourceSha.slice(0, 8)}).`;
      }

      return [
        `Branch comparison: ${source_branch} vs ${target_branch}`,
        ``,
        `${source_branch}: ${sourceSha.slice(0, 8)}`,
        `${target_branch}: ${targetSha.slice(0, 8)}`,
        ``,
        `The branches have diverged. To see the full diff, check Azure DevOps:`,
        `${AZURE_DEVOPS_ORG}${encodeURIComponent(AZURE_DEVOPS_PROJECT)}/_git/${repository}/branchCompare?baseVersion=GB${target_branch}&targetVersion=GB${source_branch}`,
      ].join("\n");
    } catch (e2) {
      return `Error comparing branches: ${e2.message}`;
    }
  }

  const changes = diffResult.changes || [];
  if (changes.length === 0) {
    return `No differences found between "${source_branch}" and "${target_branch}" in ${repository}.`;
  }

  const summary = {
    add: changes.filter((c) => c.changeType === "add").length,
    edit: changes.filter((c) => c.changeType === "edit").length,
    delete: changes.filter((c) => c.changeType === "delete").length,
  };

  const lines = [
    `Branch comparison: ${source_branch} vs ${target_branch} in ${repository}`,
    ``,
    `Summary: ${changes.length} file(s) changed`,
    `  Added: ${summary.add}`,
    `  Modified: ${summary.edit}`,
    `  Deleted: ${summary.delete}`,
    ``,
    `Changed files:`,
  ];

  for (const change of changes.slice(0, 20)) {
    const icon = change.changeType === "add" ? "+" : change.changeType === "delete" ? "-" : "~";
    const path = change.item?.path || "unknown";
    lines.push(`  ${icon} ${path}`);
  }

  if (changes.length > 20) {
    lines.push(`  ... and ${changes.length - 20} more files`);
  }

  lines.push("");
  lines.push(`Full diff: ${AZURE_DEVOPS_ORG}${encodeURIComponent(AZURE_DEVOPS_PROJECT)}/_git/${repository}/branchCompare?baseVersion=GB${target_branch}&targetVersion=GB${source_branch}`);

  return lines.join("\n");
}

module.exports = {
  name: "az_branch_diff",
  input_schema: {
    type: "object",
    properties: {
      repository: { type: "string", description: "Repository name" },
      source_branch: { type: "string", description: "Source branch to compare (e.g. feature/xyz, approach-v1)" },
      target_branch: { type: "string", description: "Target/base branch to compare against (e.g. dev, main)" },
    },
    required: ["repository", "source_branch", "target_branch"],
  },
  description:
    'Compare two branches in a repository. Shows files changed between source_branch and target_branch. Args: {"repository": "ondc-mono-repo", "source_branch": "approach-v1", "target_branch": "dev"}',
  fn: async (args) => {
    try {
      return await branchDiff(args);
    } catch (e) {
      return `Error comparing branches: ${e.message}`;
    }
  },
};
