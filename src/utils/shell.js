const { execFile } = require("child_process");

let _debugMode = false;

function setDebugMode(enabled) {
  _debugMode = enabled;
}

function execAzCli(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };

    execFile(
      "az",
      args,
      { timeout: timeoutMs, env, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const cmd = `az ${args.join(" ")}`;
        if (err) {
          if (_debugMode) {
            console.error(`\n┌─ AZ CLI ERROR ───────────────────────────────────`);
            console.error(`│ CMD: ${cmd}`);
            console.error(`│ ${(stderr || err.message).split("\n").join("\n│ ")}`);
            console.error(`└──────────────────────────────────────────────────\n`);
          }
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
        if (_debugMode) {
          console.error(`\n┌─ AZ CLI RESULT ──────────────────────────────────`);
          console.error(`│ CMD: ${cmd}`);
          const lines = stdout.trim().split("\n");
          lines.forEach((line) => console.error(`│ ${line}`));
          console.error(`└──────────────────────────────────────────────────\n`);
        }
        resolve(stdout.trim());
      }
    );
  });
}

module.exports = { execAzCli, setDebugMode };
