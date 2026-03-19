const { app, BrowserWindow, ipcMain, shell, systemPreferences } = require("electron");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

let mainWindow = null;
let miniWindow = null;
let latestMiniState = {
  active: false,
  taskTitle: "",
  timeLabel: "00:00",
  durationLabel: "",
  progressRatio: 0,
  phase: "idle",
  pinned: true,
};

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

async function runAppleScript(lines) {
  const script = Array.isArray(lines) ? lines.join("\n") : lines;
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim();
}

async function getFrontmostAppAndWindow() {
  if (process.platform !== "darwin") {
    return { appName: "", windowTitle: "" };
  }

  try {
    const output = await runAppleScript([
      'tell application "System Events"',
      "set frontApp to name of first application process whose frontmost is true",
      "end tell",
      'set frontTitle to ""',
      'tell application "System Events"',
      "tell process frontApp",
      "try",
      "set frontTitle to name of front window",
      "end try",
      "end tell",
      "end tell",
      'return frontApp & "||" & frontTitle',
    ]);
    const [appName = "", windowTitle = ""] = output.split("||");
    return { appName, windowTitle };
  } catch {
    return { appName: "", windowTitle: "" };
  }
}

async function getBrowserUrl(appName) {
  const browserScripts = {
    "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
    Safari: 'tell application "Safari" to get URL of front document',
    Arc: 'tell application "Arc" to get URL of active tab of front window',
    "Brave Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
    "Microsoft Edge": 'tell application "Microsoft Edge" to get URL of active tab of front window',
  };

  if (!browserScripts[appName]) {
    return "";
  }

  try {
    return await runAppleScript(browserScripts[appName]);
  } catch {
    return "";
  }
}

async function getActiveContext() {
  const context = await getFrontmostAppAndWindow();
  if (!context.appName) {
    return { appName: "", windowTitle: "", url: "" };
  }
  const url = await getBrowserUrl(context.appName);
  return { ...context, url };
}

function getRendererUrl(mode) {
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    return `${startUrl}${startUrl.includes("?") ? "&" : "?"}mode=${mode}`;
  }
  return null;
}

function wireNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const appUrl = process.env.ELECTRON_START_URL;
    const isAppNavigation = appUrl ? url.startsWith(appUrl) : url.startsWith("file://");
    if (!isAppNavigation) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDesc, failedUrl) => {
    window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<h3>Tempo failed to load</h3><p>${errorCode}: ${errorDesc}</p><p>${failedUrl}</p>`,
      )}`,
    );
  });
}

function loadRenderer(window, mode) {
  const startUrl = getRendererUrl(mode);
  if (startUrl) {
    void window.loadURL(startUrl);
    return;
  }
  void window.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
    search: `mode=${mode}`,
  });
}

function createMainWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 680,
    height: 500,
    minWidth: 680,
    minHeight: 500,
    maxWidth: 680,
    maxHeight: 500,
    resizable: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    title: "Tempo",
    backgroundColor: "#d6d6d6",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  wireNavigation(mainWindow);
  loadRenderer(mainWindow, "main");

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function sendMiniState() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send("mini:state", latestMiniState);
  }
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    return miniWindow;
  }

  miniWindow = new BrowserWindow({
    width: 252,
    height: 312,
    minWidth: 252,
    minHeight: 312,
    maxWidth: 252,
    maxHeight: 312,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: latestMiniState.pinned,
    skipTaskbar: false,
    movable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  miniWindow.setAlwaysOnTop(latestMiniState.pinned, "screen-saver");
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  wireNavigation(miniWindow);
  loadRenderer(miniWindow, "mini");
  miniWindow.once("ready-to-show", () => {
    sendMiniState();
    if (latestMiniState.active) {
      miniWindow.showInactive();
    }
  });
  miniWindow.on("closed", () => {
    miniWindow = null;
  });

  return miniWindow;
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: "Tempo",
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });

  ipcMain.handle("window:get-mini-always-on-top", () => miniWindow?.isAlwaysOnTop() ?? latestMiniState.pinned);

  ipcMain.handle("window:set-mini-always-on-top", (_event, shouldPin) => {
    latestMiniState.pinned = Boolean(shouldPin);
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.setAlwaysOnTop(latestMiniState.pinned, "screen-saver");
    }
    sendMiniState();
    return latestMiniState.pinned;
  });

  ipcMain.handle("strict:get-screen-permission-status", () => {
    if (process.platform !== "darwin") {
      return "unsupported";
    }
    return systemPreferences.getMediaAccessStatus("screen");
  });

  ipcMain.handle("strict:open-screen-permission-settings", () => {
    if (process.platform !== "darwin") {
      return false;
    }
    void shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    return true;
  });

  ipcMain.handle("strict:get-active-context", async () => getActiveContext());

  ipcMain.on("mini:update-state", (_event, state) => {
    latestMiniState = { ...latestMiniState, ...state };
    if (latestMiniState.active) {
      createMiniWindow();
      sendMiniState();
      if (miniWindow && !miniWindow.isVisible()) {
        miniWindow.showInactive();
      }
    } else if (miniWindow && !miniWindow.isDestroyed()) {
      sendMiniState();
      miniWindow.hide();
    }
  });

  ipcMain.handle("mini:get-state", () => latestMiniState);

  ipcMain.on("mini:control", (_event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mini:command", command);
    }
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
