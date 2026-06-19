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
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const http = require("http");
const { fork } = require("child_process");
const { checkForUpdates } = require("./updater");

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
