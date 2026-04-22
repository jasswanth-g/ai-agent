const { execAzCli } = require("../utils/shell");
const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT } = require("../config");
const { SERVICE_ALIASES } = require("../config/serviceAliases");

/**
 * Simple Levenshtein distance for fuzzy matching.
 */
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

async function resolveService({ service_name }) {
  if (!service_name) return "Error: service_name is required.";

  // Normalize: lowercase, trim, collapse runs of spaces/underscores into a single hyphen,
  // so "hm queue", "HM_Queue", "pre order service" all hit the exact-match path.
  const nameLower = service_name.toLowerCase().trim().replace(/[\s_]+/g, "-");

  // Step 1: Exact match
  if (SERVICE_ALIASES[nameLower]) {
    const ids = SERVICE_ALIASES[nameLower];
    return [
      `Service: ${nameLower}`,
      `buildPipelineId: ${ids.buildPipelineId}`,
      `releasePipelineId: ${ids.releasePipelineId}`,
    ].join("\n");
  }

  // Step 2: Partial/includes match
  for (const [alias, ids] of Object.entries(SERVICE_ALIASES)) {
    if (alias.includes(nameLower) || nameLower.includes(alias)) {
      return [
        `Service: ${alias}`,
        `buildPipelineId: ${ids.buildPipelineId}`,
        `releasePipelineId: ${ids.releasePipelineId}`,
      ].join("\n");
    }
  }

  // Step 3: Fuzzy match — find closest service name
  const aliases = Object.keys(SERVICE_ALIASES);
  const scored = aliases
    .map((alias) => ({ alias, distance: levenshtein(nameLower, alias) }))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  // Accept if distance is within 40% of the name length (generous for typos)
  if (best && best.distance <= Math.ceil(nameLower.length * 0.4)) {
    const ids = SERVICE_ALIASES[best.alias];
    return [
      `Service: ${best.alias} (did you mean this?)`,
      `buildPipelineId: ${ids.buildPipelineId}`,
      `releasePipelineId: ${ids.releasePipelineId}`,
    ].join("\n");
  }

  // Step 4: Suggest closest matches
  const suggestions = scored.slice(0, 3).map((s) => s.alias);
  return `No service found matching "${service_name}". Did you mean: ${suggestions.join(", ")}?`;
}

module.exports = {
  name: "az_resolve_service",
  input_schema: {
    type: "object",
    properties: {
      service_name: { type: "string", description: "Service name to resolve, e.g. 'core-service', 'partner-portal'" },
    },
    required: ["service_name"],
  },
  description:
    'Resolve a service name to its build and release pipeline IDs. Always call this FIRST when a user mentions a service name. Args: {"service_name": "pre-order-service"}',
  fn: async (args) => {
    try {
      return await resolveService(args);
    } catch (e) {
      return `Error resolving service: ${e.message}`;
    }
  },
};
