const { execFile } = require("child_process");
const { AZURE_DEVOPS_PAT } = require("../config");

/**
 * Execute an Azure CLI command safely using execFile (no shell interpolation).
 * @param {string[]} args - Arguments to pass to `az` (e.g., ["pipelines", "list"])
 * @param {object} options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<string>} - Resolved stdout output
 */
function execAzCli(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (AZURE_DEVOPS_PAT) {
      env.AZURE_DEVOPS_EXT_PAT = AZURE_DEVOPS_PAT;
    }

    execFile(
      "az",
      args,
      { timeout: timeoutMs, env, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === "ENOENT") {
            return reject(
              new Error("Azure CLI (az) is not installed or not in PATH")
            );
          }
          if (err.killed) {
            return reject(
              new Error(`Command timed out after ${timeoutMs / 1000}s`)
            );
          }
          return reject(new Error(stderr || err.message));
        }
        resolve(stdout.trim());
      }
    );
  });
}

module.exports = { execAzCli };
