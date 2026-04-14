const fs = require("fs");
const path = require("path");

/**
 * Auto-loads all tool files in this directory (except index.js).
 * Each tool file must export: { name, description, fn }
 */
function loadTools() {
  const tools = {};
  const toolDir = __dirname;

  const files = fs.readdirSync(toolDir).filter(
    (f) => f.endsWith(".js") && f !== "index.js"
  );

  for (const file of files) {
    const tool = require(path.join(toolDir, file));
    tools[tool.name] = {
      description: tool.description,
      fn: tool.fn,
      input_schema: tool.input_schema,
    };
  }

  return tools;
}

function getToolDescriptions(tools) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [name, t.description])
  );
}

/**
 * Convert tools to Claude API tool format.
 * Each tool gets a name, description, and input_schema.
 */
function getClaudeTools(tools) {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: t.input_schema || {
      type: "object",
      properties: {},
      required: [],
    },
  }));
}

async function runTool(tools, name, args) {
  if (!tools[name]) return `Unknown tool: ${name}`;
  try {
    return await tools[name].fn(args || {});
  } catch (e) {
    return `Tool error: ${e.message}`;
  }
}

module.exports = { loadTools, getToolDescriptions, getClaudeTools, runTool };
