const Configstore = require("configstore");

const config = new Configstore("aiagent");

const CONFIG_KEYS = {
  AZURE_DEVOPS_ORG: "azureDevOpsOrg",
  AZURE_DEVOPS_PROJECT: "azureDevOpsProject",
};

function getConfig(key) {
  return process.env[key] || config.get(CONFIG_KEYS[key]) || "";
}

function setConfig(key, value) {
  if (!CONFIG_KEYS[key]) throw new Error(`Unknown config key: ${key}`);
  config.set(CONFIG_KEYS[key], value);
}

module.exports = { getConfig, setConfig, config };
