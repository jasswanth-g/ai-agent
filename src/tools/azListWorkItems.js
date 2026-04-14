const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");

// Cache team members
let cachedMembers = null;

async function getTeamMembers() {
  if (cachedMembers) return cachedMembers;
  try {
    const wiql = "SELECT [System.Id], [System.AssignedTo] FROM WorkItems WHERE [System.AssignedTo] <> '' ORDER BY [System.ChangedDate] DESC";
    const output = await execAzCli(["boards", "query", "--wiql", wiql, "--org", AZURE_DEVOPS_ORG, "--project", AZURE_DEVOPS_PROJECT, "--output", "json"]);
    const items = JSON.parse(output);
    const names = new Set();
    items.forEach((i) => {
      const name = i.fields?.["System.AssignedTo"]?.displayName;
      if (name) names.add(name);
    });
    cachedMembers = [...names];
    return cachedMembers;
  } catch {
    return [];
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

async function resolvePersonName(input) {
  const members = await getTeamMembers();
  const inputLower = input.toLowerCase();

  // Exact match on first name or full name
  const exact = members.find((m) =>
    m.toLowerCase() === inputLower ||
    m.toLowerCase().split(" ")[0] === inputLower
  );
  if (exact) return exact;

  // Partial match — first name contains
  const partial = members.find((m) =>
    m.toLowerCase().includes(inputLower) ||
    inputLower.includes(m.toLowerCase().split(" ")[0])
  );
  if (partial) return partial;

  // Fuzzy match on first name
  const scored = members
    .map((m) => ({
      name: m,
      distance: levenshtein(inputLower, m.toLowerCase().split(" ")[0]),
    }))
    .sort((a, b) => a.distance - b.distance);

  if (scored[0] && scored[0].distance <= Math.ceil(inputLower.length * 0.4)) {
    return scored[0].name;
  }

  return null;
}

async function listWorkItems({ assigned_to, state, type }) {
  const conditions = [];

  if (assigned_to && assigned_to.toLowerCase() === "me") {
    conditions.push("[System.AssignedTo] = @Me");
  } else if (assigned_to) {
    // First try to find the full display name by fuzzy matching
    const resolvedName = await resolvePersonName(assigned_to);
    if (resolvedName) {
      conditions.push(`[System.AssignedTo] = '${resolvedName}'`);
    } else {
      conditions.push(`[System.AssignedTo] Contains '${assigned_to}'`);
    }
  }

  if (state) {
    if (state.toLowerCase() === "all") {
      // No state filter — show everything
    } else {
      conditions.push(`[System.State] = '${state}'`);
    }
  } else {
    // Default: Active, New, and OnHold (exclude Closed and Removed)
    conditions.push("[System.State] <> 'Closed'");
    conditions.push("[System.State] <> 'Removed'");
  }

  if (type) {
    conditions.push(`[System.WorkItemType] = '${type}'`);
  }

  const wiql = `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;

  const args = [
    "boards", "query",
    "--wiql", wiql,
    "--org", AZURE_DEVOPS_ORG,
    "--project", AZURE_DEVOPS_PROJECT,
    "--output", "json",
  ];

  const output = await execAzCli(args);
  const items = JSON.parse(output);

  if (!items.length) return "No work items found.";

  const stateIcons = {
    "Active": "🟢",
    "New": "🔵",
    "On Hold": "🟡",
    "OnHold": "🟡",
    "Resolved": "🟣",
    "Closed": "⚫",
  };

  // Build table
  const header = `  ${"ID".padEnd(8)}${"Type".padEnd(14)}${"State".padEnd(12)}${"Assigned To".padEnd(22)}Title`;
  const separator = "  " + "─".repeat(90);

  const rows = items.map((item) => {
    const id = `#${item.id}`;
    const type = item.fields?.["System.WorkItemType"] || "N/A";
    const state = item.fields?.["System.State"] || "Unknown";
    const icon = stateIcons[state] || "⚪";
    const assignee = item.fields?.["System.AssignedTo"]?.displayName || "Unassigned";
    const title = item.fields?.["System.Title"] || "N/A";
    return `  ${id.padEnd(8)}${type.padEnd(14)}${icon} ${state.padEnd(10)}${assignee.padEnd(22)}${title}`;
  });

  const lines = [
    `  Total: ${items.length} work item(s)\n`,
    separator,
    header,
    separator,
    ...rows,
    separator,
  ];

  return lines.join("\n");
}

module.exports = {
  name: "az_list_work_items",
  input_schema: {
    type: "object",
    properties: {
      assigned_to: { type: "string", description: "Filter by assigned person. Use 'me' for current user." },
      state: { type: "string", description: "Filter by state: Active, New, Resolved, Closed" },
      type: { type: "string", description: "Filter by type: Bug, Task, User Story, Feature" },
    },
    required: [],
  },
  description:
    'List Azure DevOps work items (bugs, tasks, stories). Use assigned_to="me" to get current user\'s items. Can filter by state and type.Always provide the result in a Table format.',
  fn: async (args) => {
    try {
      return await listWorkItems(args);
    } catch (e) {
      return `Error listing work items: ${e.message}`;
    }
  },
};
