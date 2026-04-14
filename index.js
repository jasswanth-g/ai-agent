#!/usr/bin/env node
const { isConfigured, runSetup } = require("./src/setup");
const { startAgent } = require("./src/core/agent");
const { runCommand } = require("./src/commands");

const DIRECT_COMMANDS = ["builds", "releases", "status", "trigger", "services"];

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--setup")) {
    await runSetup();
    return;
  }

  if (!isConfigured()) {
    console.log("\n  First time? Let's set things up.\n");
    await runSetup();
  }

  // Headless mode: qwipo --prompt "give build for partner-portal from dev"
  const promptIdx = args.indexOf("--prompt");
  if (promptIdx !== -1) {
    const prompt = args.slice(promptIdx + 1).join(" ");
    if (!prompt) {
      console.error("Error: --prompt requires a message");
      process.exit(1);
    }
    const { runHeadless } = require("./src/core/headless");
    try {
      const result = await runHeadless(prompt);
      console.log(result);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Direct command mode: qwipo builds core-service
  if (args.length > 0 && DIRECT_COMMANDS.includes(args[0])) {
    try {
      await runCommand(args[0], args.slice(1));
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Unknown command — show help
  if (args.length > 0) {
    await runCommand(args[0], args.slice(1));
    return;
  }

  // Interactive mode
  await startAgent();
}

main().catch(console.error);
