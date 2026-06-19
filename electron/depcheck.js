/**
 * First-run dependency gate.
 *
 * The app shells out to the Azure CLI, and specifically to `az pipelines` /
 * `az repos`, which come from the `azure-devops` EXTENSION (not core az). This
 * verifies both before the UI is usable so recipients don't hit a cryptic
 * in-page build error:
 *   1. Azure CLI present?  -> if not, point them at the install guide.
 *   2. azure-devops ext?   -> if not, install it (no sudo needed). az's own
 *                             pip auto-install is unreliable; we do it directly.
 *
 * Returns true when the app is good to go, false when it should quit.
 */
const { dialog, shell } = require("electron");
const { execFile } = require("child_process");

const AZ_DOC = "https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos";

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile("az", args, { timeout: timeoutMs }, (err) => resolve(!err));
  });
}

const hasAz = () => run(["version", "-o", "json"], 20000);
const hasDevopsExt = () => run(["extension", "show", "--name", "azure-devops"], 20000);
const installDevopsExt = () => run(["extension", "add", "--name", "azure-devops"], 180000);

// Auth helpers. `az login` opens the browser and blocks until the user finishes,
// so give it a long timeout.
const isLoggedIn = () => run(["account", "show"], 15000);
const runAzLogin = () => run(["login"], 300000);

async function ensureDependencies() {
  // 1. Azure CLI itself.
  if (!(await hasAz())) {
    const { response } = await dialog.showMessageBox({
      type: "error",
      message: "Azure CLI is required",
      detail:
        "Qwipo DevOps uses the Azure CLI (az) to talk to Azure DevOps, but it isn't " +
        "installed (or isn't on the PATH).\n\nInstall it, then reopen Qwipo DevOps.",
      buttons: ["Open Install Guide", "Quit"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(AZ_DOC);
    return false;
  }

  // 2. azure-devops extension — provides az pipelines / az repos (the whole app).
  if (!(await hasDevopsExt())) {
    const installed = await installDevopsExt();
    if (!installed) {
      const { response } = await dialog.showMessageBox({
        type: "error",
        message: "Couldn't set up the Azure DevOps extension",
        detail:
          "The app needs the 'azure-devops' CLI extension (for az pipelines / az repos), " +
          "and the automatic install failed.\n\nRun this in Terminal, then reopen Qwipo DevOps:\n\n" +
          "    az extension add --name azure-devops",
        buttons: ["Open Install Guide", "Quit"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(AZ_DOC);
      return false;
    }
  }

  return true;
}

module.exports = { ensureDependencies, isLoggedIn, runAzLogin };
