const inquirer = require("inquirer");
const Configstore = require("configstore");
const chalk = require("chalk");

const config = new Configstore("aiagent");

const CONFIG_KEYS = {
  AZURE_DEVOPS_PAT: "azureDevOpsPat",
  AZURE_DEVOPS_ORG: "azureDevOpsOrg",
  AZURE_DEVOPS_PROJECT: "azureDevOpsProject",
};

const DEFAULTS = {
  azureDevOpsOrg: "https://dev.azure.com/xavica/",
  azureDevOpsProject: "Qwipo B2B",
};

function isConfigured() {
  return !!config.get(CONFIG_KEYS.AZURE_DEVOPS_PAT);
}

function getConfig(key) {
  return process.env[key] || config.get(CONFIG_KEYS[key]) || DEFAULTS[CONFIG_KEYS[key]] || "";
}

async function runSetup() {
  console.log(chalk.cyan.bold("\n  aiAgent Setup\n"));
  console.log(chalk.gray("  Configure your Azure DevOps connection.\n"));

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "org",
      message: "Azure DevOps Org URL:",
      default: getConfig("AZURE_DEVOPS_ORG"),
    },
    {
      type: "input",
      name: "project",
      message: "Azure DevOps Project:",
      default: getConfig("AZURE_DEVOPS_PROJECT"),
    },
    {
      type: "password",
      name: "pat",
      message: "Azure DevOps PAT:",
      mask: "*",
      validate: (input) => input.length > 0 || "PAT is required",
    },
  ]);

  config.set(CONFIG_KEYS.AZURE_DEVOPS_ORG, answers.org);
  config.set(CONFIG_KEYS.AZURE_DEVOPS_PROJECT, answers.project);
  config.set(CONFIG_KEYS.AZURE_DEVOPS_PAT, answers.pat);

  console.log(chalk.green("\n  Configuration saved successfully!"));
  console.log(chalk.gray(`  Stored at: ${config.path}\n`));
}

module.exports = { isConfigured, getConfig, runSetup, config };
