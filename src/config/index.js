const { getConfig } = require("../setup");

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = getConfig("OLLAMA_MODEL") || "qwen2.5:7b";
const MAX_TOOL_STEPS = 10;

const AZURE_DEVOPS_ORG = getConfig("AZURE_DEVOPS_ORG");
const AZURE_DEVOPS_PROJECT = getConfig("AZURE_DEVOPS_PROJECT");

module.exports = {
  OLLAMA_URL,
  MODEL,
  MAX_TOOL_STEPS,
  AZURE_DEVOPS_ORG,
  AZURE_DEVOPS_PROJECT,
};
