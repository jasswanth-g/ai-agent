const chalk = require("chalk");
const ora = require("ora");
const { loadTools, runTool } = require("./tools");
const { SERVICE_ALIASES } = require("./config/serviceAliases");

async function resolveService(serviceName) {
  const tools = loadTools();
  const result = await runTool(tools, "az_resolve_service", { service_name: serviceName });
  return result;
}

async function runCommand(command, args) {
  const tools = loadTools();

  switch (command) {
    case "builds": {
      const serviceName = args[0];
      if (!serviceName) {
        console.log(chalk.red("  Usage: qwipo builds <service-name>"));
        return;
      }
      let spinner = ora(`Resolving ${serviceName}...`).start();
      const resolved = await runTool(tools, "az_resolve_service", { service_name: serviceName });
      const match = resolved.match(/buildPipelineId:\s*(\d+)/);
      if (!match) {
        spinner.fail(`Service "${serviceName}" not found`);
        console.log(resolved);
        return;
      }
      spinner.succeed(`Resolved ${serviceName}`);
      spinner = ora("Fetching builds...").start();
      const top = args[1] || "5";
      const result = await runTool(tools, "az_list_builds", { pipeline_id: match[1], top });
      spinner.succeed("Builds fetched");
      console.log("\n" + result + "\n");
      break;
    }

    case "status": {
      const buildId = args[0];
      if (!buildId) {
        console.log(chalk.red("  Usage: qwipo status <build-id>"));
        return;
      }
      const spinner = ora(`Checking build #${buildId}...`).start();
      const result = await runTool(tools, "az_build_status", { build_id: buildId });
      spinner.succeed("Done");
      console.log("\n" + result + "\n");
      break;
    }

    case "releases": {
      const serviceName = args[0];
      if (!serviceName) {
        console.log(chalk.red("  Usage: qwipo releases <service-name>"));
        return;
      }
      let spinner = ora(`Resolving ${serviceName}...`).start();
      const resolved = await runTool(tools, "az_resolve_service", { service_name: serviceName });
      const match = resolved.match(/releasePipelineId:\s*(\d+)/);
      if (!match) {
        spinner.fail(`Service "${serviceName}" not found`);
        console.log(resolved);
        return;
      }
      spinner.succeed(`Resolved ${serviceName}`);
      spinner = ora("Fetching releases...").start();
      const top = args[1] || "5";
      const result = await runTool(tools, "az_list_deployments", { definition_id: match[1], top });
      spinner.succeed("Releases fetched");
      console.log("\n" + result + "\n");
      break;
    }

    case "services": {
      const names = Object.keys(SERVICE_ALIASES);
      console.log(chalk.cyan.bold("\n  Configured Services:\n"));
      names.forEach((n) => console.log("  " + chalk.white(n)));
      console.log(chalk.gray(`\n  Total: ${names.length} services\n`));
      break;
    }

    case "trigger": {
      const serviceName = args[0];
      const branch = args[1];
      if (!serviceName || !branch) {
        console.log(chalk.red("  Usage: qwipo trigger <service-name> <branch>"));
        return;
      }
      let spinner = ora(`Resolving ${serviceName}...`).start();
      const resolved = await runTool(tools, "az_resolve_service", { service_name: serviceName });
      const match = resolved.match(/buildPipelineId:\s*(\d+)/);
      if (!match) {
        spinner.fail(`Service "${serviceName}" not found`);
        return;
      }
      spinner.succeed(`Resolved ${serviceName}`);
      spinner = ora(`Triggering build on ${branch}...`).start();
      const result = await runTool(tools, "az_trigger_build", { pipeline_id: match[1], branch });
      spinner.succeed("Build triggered");
      console.log("\n" + result + "\n");
      break;
    }

    default:
      console.log(chalk.red(`  Unknown command: ${command}`));
      console.log("");
      console.log(chalk.cyan("  Available commands:"));
      console.log(chalk.white("    qwipo                         ") + chalk.gray("— Interactive mode"));
      console.log(chalk.white("    qwipo builds <service>        ") + chalk.gray("— List recent builds"));
      console.log(chalk.white("    qwipo releases <service>      ") + chalk.gray("— List recent releases"));
      console.log(chalk.white("    qwipo status <build-id>       ") + chalk.gray("— Check build status"));
      console.log(chalk.white("    qwipo trigger <service> <branch>") + chalk.gray(" — Trigger a build"));
      console.log(chalk.white("    qwipo services                ") + chalk.gray("— List all services"));
      console.log(chalk.white("    qwipo --prompt \"<message>\"    ") + chalk.gray("— Headless mode (for agent-to-agent)"));
      console.log(chalk.white("    qwipo --setup                 ") + chalk.gray("— Reconfigure"));
      console.log("");
  }
}

module.exports = { runCommand };
