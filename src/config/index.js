const { getConfig } = require("../setup");

const AZURE_DEVOPS_ORG = getConfig("AZURE_DEVOPS_ORG");
const AZURE_DEVOPS_PROJECT = getConfig("AZURE_DEVOPS_PROJECT");
const AZURE_DEVOPS_SERVICES_URL = getConfig("SERVICES_URL");

module.exports = {
  AZURE_DEVOPS_ORG,
  AZURE_DEVOPS_PROJECT,
  AZURE_DEVOPS_SERVICES_URL,
};
