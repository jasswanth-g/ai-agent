/**
 * Electron shell for the Qwipo DevOps web UI.
 *
 * This does NOT reimplement anything — it boots the existing web server
 * (src/web/server.js) as a child process and shows it in a native window.
 * Everything the browser version does works unchanged.
 *
 * macOS note: GUI apps launched from Finder do NOT inherit your shell's PATH,
 * so `az` / `brew` would be invisible to the server. fixPath() puts the usual
 * Homebrew + system locations back so the Azure CLI is found.
 */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const { fork } = require("child_process");
const { checkForUpdates } = require("./updater");
const { ensureDependencies, isLoggedIn, runAzLogin } = require("./depcheck");
const { readOrgProject, saveOrgProject } = require("./config");

const PORT = Number(process.env.QWIPO_WEB_PORT) || 4317;
const APP_URL = `http://localhost:${PORT}`;
const SERVER_ENTRY = path.join(__dirname, "..", "src", "web", "server.js");

let serverProc = null;
let mainWindow = null;

/** Restore the PATH a GUI app loses, so the server can find `az` and `brew`. */
function fixPath() {
  const common = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const current = (process.env.PATH || "").split(":").filter(Boolean);
  process.env.PATH = [...new Set([...common, ...current])].join(":");
}

/** Launch the existing web server as a Node child process. */
function startServer() {
  serverProc = fork(SERVER_ENTRY, [], {
    // ELECTRON_RUN_AS_NODE makes the forked Electron binary behave as plain Node,
    // so server.js runs exactly like `node src/web/server.js`.
    // QWIPO_DATA_DIR points the server at a writable location for runtime files
    // (e.g. the credentials vault) — the app bundle itself is read-only.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      QWIPO_WEB_PORT: String(PORT),
      QWIPO_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code && code !== 0) console.error(`[server] exited with code ${code}`);
  });
}

/** Resolve once the server answers on its port (or reject after timeout). */
function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(APP_URL, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("web server did not start in time"));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "Qwipo DevOps",
    backgroundColor: "#0b0f17",
    webPreferences: { contextIsolation: true },
  });
  mainWindow.loadURL(APP_URL);
  // Open target=_blank / external links in the system browser, not a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * First-run setup window: asks for the Azure DevOps org URL + project and saves
 * them to config. Resolves true once saved, false if the user closed it without
 * saving (in which case the app can't run, so we quit).
 */
function runSetupWindow(defaults) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 560,
      resizable: false,
      title: "Qwipo DevOps — Setup",
      backgroundColor: "#0b0f17",
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, "setup-preload.js"),
      },
    });

    let saved = false;
    ipcMain.handleOnce("setup:save", (_evt, { org, project, servicesUrl }) => {
      saveOrgProject(org, project, servicesUrl);
      saved = true;
      win.close();
      return true;
    });

    win.loadFile(path.join(__dirname, "setup.html"), {
      search: new URLSearchParams({
        org: defaults.org || "",
        project: defaults.project || "",
        servicesUrl: defaults.servicesUrl || "",
      }).toString(),
    });
    win.on("closed", () => {
      ipcMain.removeHandler("setup:save");
      resolve(saved);
    });
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Change Org & Project…",
          click: async () => {
            const saved = await runSetupWindow(readOrgProject());
            // Relaunch so the server picks up the new org/project at startup.
            if (saved) {
              app.relaunch();
              app.exit(0);
            }
          },
        },
        {
          label: "Check for Updates…",
          click: () => checkForUpdates({ silent: false }),
        },
        { type: "separator" },
        {
          label: "Open in Browser",
          click: () => shell.openExternal(APP_URL),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  fixPath();

  // Make sure the Azure CLI + azure-devops extension are present before the UI
  // is usable. If a required piece is missing and can't be set up, quit cleanly.
  if (!(await ensureDependencies())) {
    app.quit();
    return;
  }

  // Sign-in: if not logged into Azure, offer to run `az login` (opens browser).
  if (!(await isLoggedIn())) {
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: "Sign in to Azure",
      detail:
        "Qwipo DevOps uses your Azure sign-in to talk to Azure DevOps. " +
        "Signing in opens your browser.",
      buttons: ["Sign In", "Continue Anyway", "Quit"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) {
      app.quit();
      return;
    }
    if (response === 0) await runAzLogin();
  }

  // Org/project: if not configured yet, ask via the setup window before the
  // server starts (the server reads these at launch).
  const cfg = readOrgProject();
  if (!cfg.org || !cfg.project) {
    const done = await runSetupWindow(cfg);
    if (!done) {
      app.quit();
      return;
    }
  }

  startServer();
  try {
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox(
      "Qwipo DevOps — startup failed",
      `The web server didn't start.\n\n${err.message}\n\nCheck that nothing else is using port ${PORT}.`
    );
    app.quit();
    return;
  }
  buildMenu();
  createWindow();

  // Quietly check GitHub Releases shortly after launch; only speaks up if there's
  // a newer version. Skipped in dev (unpackaged) since the version is just dev.
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates({ silent: true }), 4000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc) serverProc.kill();
});
