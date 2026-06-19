/**
 * Notify-only updater (no code signing required).
 *
 * Checks this repo's GitHub Releases for a newer version than the running app.
 * If one exists, it tells the user and opens the release page so they can
 * download the new .dmg — it does NOT silently install (that needs an
 * Apple-signed + notarized build). Upgrade path later: swap this for
 * electron-updater's autoUpdater once the app is signed.
 */
const { dialog, shell, app } = require("electron");
const https = require("https");

const OWNER = "jasswanth-g";
const REPO = "ai-agent";

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        method: "GET",
        headers: {
          "User-Agent": "Qwipo-DevOps-Updater",
          Accept: "application/vnd.github+json",
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("update check timed out")));
    req.on("error", reject);
    req.end();
  });
}

// "v1.2.3" / "1.2.3" -> [1,2,3]
function parseVer(v) {
  return String(v || "")
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}
function isNewer(remote, local) {
  const a = parseVer(remote);
  const b = parseVer(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.silent=true] When true (auto-check on launch), stay
 *   quiet unless there's actually an update. When false (manual menu check),
 *   also report "up to date" / errors.
 */
async function checkForUpdates({ silent = true } = {}) {
  let rel;
  try {
    rel = await fetchLatestRelease();
  } catch (err) {
    if (!silent) {
      dialog.showMessageBox({
        type: "warning",
        message: "Couldn't check for updates",
        detail: err.message,
        buttons: ["OK"],
      });
    }
    return;
  }

  const current = app.getVersion();
  const latest = rel && rel.tag_name;

  if (latest && isNewer(latest, current)) {
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: "A new version of Qwipo DevOps is available",
      detail: `You have ${current}. ${latest.replace(/^v/i, "")} is available.\n\n${
        rel.name || ""
      }\n\nDownload it, then drag the new app into Applications (replacing the old one).`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(rel.html_url);
  } else if (!silent) {
    dialog.showMessageBox({
      type: "info",
      message: "You're up to date",
      detail: `Qwipo DevOps ${current} is the latest version.`,
      buttons: ["OK"],
    });
  }
}

module.exports = { checkForUpdates };
