#!/usr/bin/env node

// --- Auto-update: once per 24h, fetch latest code from GitHub so users always
// run the freshest version without a manual `git pull`. Opt out with the env
// var QWIPO_NO_UPDATE=1 or the flag --no-update. Skipped in --prompt (headless)
// mode so agent-to-agent callers don't inherit update latency.
(function autoUpdate() {
  if (process.env.QWIPO_NO_UPDATE === "1") return;
  if (process.argv.includes("--no-update")) return;
  if (process.argv.includes("--prompt")) return;

  const path = require("path");
  const fs = require("fs");
  const { execSync, spawnSync } = require("child_process");

  const installDir = __dirname;
  if (!fs.existsSync(path.join(installDir, ".git"))) return;

  const stampFile = path.join(installDir, ".last-update-check");
  let last = 0;
  try { last = fs.statSync(stampFile).mtimeMs; } catch {}
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (Date.now() - last < ONE_DAY) return;

  try {
    process.stderr.write("  Checking for qwipo updates…");
    const before = execSync("git rev-parse HEAD", { cwd: installDir, encoding: "utf8" }).trim();
    execSync("git pull --ff-only --quiet", { cwd: installDir, stdio: "ignore", timeout: 5000 });
    const after = execSync("git rev-parse HEAD", { cwd: installDir, encoding: "utf8" }).trim();
    try { fs.writeFileSync(stampFile, ""); } catch {}

    if (before === after) {
      process.stderr.write(" up to date.\n");
      return;
    }

    process.stderr.write(" updated — reloading.\n");

    const changed = execSync(`git diff --name-only ${before} ${after}`, { cwd: installDir, encoding: "utf8" });
    if (changed.split("\n").some((f) => f === "package.json" || f === "package-lock.json")) {
      process.stderr.write("  Installing updated npm deps…\n");
      execSync("npm install --production --silent", { cwd: installDir, stdio: "inherit", timeout: 60000 });
    }

    // Re-exec the CLI with the same args so this invocation runs the new code.
    const result = spawnSync(process.argv[0], process.argv.slice(1), { stdio: "inherit" });
    process.exit(result.status ?? 0);
  } catch (e) {
    process.stderr.write(" (check skipped — offline or local changes)\n");
  }
})();

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
