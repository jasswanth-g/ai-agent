const { execFile } = require("child_process");
const inquirer = require("inquirer");
const Configstore = require("configstore");
const chalk = require("chalk");
const ora = require("ora");

const config = new Configstore("aiagent");

const CONFIG_KEYS = {
  AZURE_DEVOPS_ORG: "azureDevOpsOrg",
  AZURE_DEVOPS_PROJECT: "azureDevOpsProject",
  OLLAMA_MODEL: "ollamaModel",
};

const RECOMMENDED_MODEL = "qwen2.5:7b";

function isConfigured() {
  return !!config.get(CONFIG_KEYS.AZURE_DEVOPS_ORG) && !!config.get(CONFIG_KEYS.AZURE_DEVOPS_PROJECT);
}

function getConfig(key) {
  return process.env[key] || config.get(CONFIG_KEYS[key]) || "";
}

function execCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function runSetup() {
  console.log(chalk.cyan.bold("\n  Qwipo DevOps Agent — Setup\n"));

  // Step 1: Check if Azure CLI is installed
  const azSpinner = ora("Checking Azure CLI...").start();
  try {
    await execCommand("az", ["--version"]);
    azSpinner.succeed("Azure CLI is installed");
  } catch {
    azSpinner.fail("Azure CLI (az) is not installed");
    console.log(chalk.yellow("\n  Install it: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest"));
    console.log(chalk.gray("  Then run: qwipo --setup\n"));
    return;
  }

  // Step 2: Check if user is logged in, prompt login if not
  const loginSpinner = ora("Checking Azure login...").start();
  try {
    await execCommand("az", ["account", "show"]);
    loginSpinner.succeed("Logged in to Azure");
  } catch {
    loginSpinner.warn("Not logged in to Azure");
    console.log(chalk.yellow("\n  You need to log in to Azure CLI first.\n"));
    const { doLogin } = await inquirer.prompt([{
      type: "confirm",
      name: "doLogin",
      message: "Run 'az login' now?",
      default: true,
    }]);
    if (doLogin) {
      console.log(chalk.gray("\n  Opening browser for Azure login...\n"));
      try {
        await execCommand("az", ["login"]);
        console.log(chalk.green("  Login successful!\n"));
      } catch (err) {
        console.log(chalk.red(`  Login failed: ${err.message}`));
        console.log(chalk.gray("  Run 'az login' manually and try again.\n"));
        return;
      }
    } else {
      console.log(chalk.gray("\n  Run 'az login' manually, then run: qwipo --setup\n"));
      return;
    }
  }

  // Step 3: Detect Azure DevOps defaults
  let detectedOrg = config.get(CONFIG_KEYS.AZURE_DEVOPS_ORG) || "";
  let detectedProject = config.get(CONFIG_KEYS.AZURE_DEVOPS_PROJECT) || "";

  if (!detectedOrg) {
    const detectSpinner = ora("Detecting Azure DevOps defaults...").start();
    try {
      const output = await execCommand("az", ["devops", "configure", "--list", "--output", "json"]);
      const parsed = JSON.parse(output);
      detectedOrg = parsed.organization || "";
      detectedProject = parsed.project || "";
      detectSpinner.succeed("Detected Azure DevOps configuration");
    } catch {
      detectSpinner.info("Could not auto-detect — you can enter manually");
    }
  }

  // Step 4: Ask for org and project
  console.log(chalk.gray("\n  Configure your Azure DevOps connection.\n"));

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "org",
      message: "Azure DevOps Org URL:",
      default: detectedOrg || "https://dev.azure.com/your-org/",
      validate: (input) => input.includes("dev.azure.com") || "Must be a valid Azure DevOps URL (e.g., https://dev.azure.com/your-org/)",
    },
    {
      type: "input",
      name: "project",
      message: "Azure DevOps Project:",
      default: detectedProject || "",
      validate: (input) => input.length > 0 || "Project name is required",
    },
  ]);

  config.set(CONFIG_KEYS.AZURE_DEVOPS_ORG, answers.org);
  config.set(CONFIG_KEYS.AZURE_DEVOPS_PROJECT, answers.project);

  // Step 5: Pick Ollama model — recommended default, auto-detect installed ones when possible.
  console.log(chalk.gray("\n  Pick the Ollama model to power the agent.\n"));

  let installedModels = [];
  try {
    const output = await execCommand("ollama", ["list"]);
    installedModels = output
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    // Ollama not installed or daemon not running — fall back to free-text entry.
  }

  const existing = config.get(CONFIG_KEYS.OLLAMA_MODEL) || RECOMMENDED_MODEL;
  let selectedModel;
  if (installedModels.length > 0) {
    const CUSTOM = "__custom__";
    const choices = [
      ...installedModels.map((m) => ({
        name: m === RECOMMENDED_MODEL ? `${m}  ${chalk.gray("(recommended)")}` : m,
        value: m,
      })),
      new inquirer.Separator(),
      { name: "Enter a model name manually…", value: CUSTOM },
    ];
    const preferredDefault = installedModels.includes(existing) ? existing : installedModels[0];
    const { picked } = await inquirer.prompt([{
      type: "list",
      name: "picked",
      message: "Which Ollama model should the agent use?",
      choices,
      default: preferredDefault,
    }]);
    if (picked === CUSTOM) {
      const { custom } = await inquirer.prompt([{
        type: "input",
        name: "custom",
        message: "Model name (e.g. qwen2.5:7b, llama3.1:8b, mistral:7b):",
        default: existing,
        validate: (i) => i.trim().length > 0 || "Model name is required",
      }]);
      selectedModel = custom.trim();
    } else {
      selectedModel = picked;
    }
  } else {
    console.log(chalk.yellow("  Couldn't detect installed models (is Ollama running?). Enter one manually.\n"));
    const { model } = await inquirer.prompt([{
      type: "input",
      name: "model",
      message: `Ollama model (recommended: ${RECOMMENDED_MODEL}):`,
      default: existing,
      validate: (i) => i.trim().length > 0 || "Model name is required",
    }]);
    selectedModel = model.trim();
  }

  config.set(CONFIG_KEYS.OLLAMA_MODEL, selectedModel);

  console.log(chalk.green("\n  Setup complete!"));
  console.log(chalk.gray(`  Config saved at: ${config.path}`));
  console.log(chalk.gray(`  Org:     ${answers.org}`));
  console.log(chalk.gray(`  Project: ${answers.project}`));
  console.log(chalk.gray(`  Model:   ${selectedModel}\n`));
}

module.exports = { isConfigured, getConfig, runSetup, config };
