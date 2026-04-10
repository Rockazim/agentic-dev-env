const os = require("node:os");
const path = require("node:path");

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } = require("electron");
const { TerminalManager } = require("./terminal-manager");

const isMac = process.platform === "darwin";
let mainWindow = null;
let terminalManager = null;

if (process.platform === "win32") {
  app.setAppUserModelId("com.agenticdevenv.desktop");
}

nativeTheme.themeSource = "dark";

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#070809",
    autoHideMenuBar: !isMac,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    terminalManager?.dispose();
    mainWindow = null;
  });

  terminalManager = new TerminalManager({
    sendToRenderer(channel, payload) {
      mainWindow?.webContents.send(channel, payload);
    },
    getDefaultCwd() {
      if (!app.isPackaged) {
        return process.cwd();
      }

      return app.getPath("home");
    }
  });

  return mainWindow;
}

app.whenReady().then(() => {
  if (!isMac) {
    Menu.setApplicationMenu(null);
  }

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (!isMac) {
    app.quit();
  }
});

ipcMain.handle("app:get-runtime-info", () => {
  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release()
  };
});

ipcMain.handle("terminal:list-profiles", () => {
  return terminalManager?.listProfiles() || [];
});

ipcMain.handle("terminal:create", (_event, options) => {
  return terminalManager.createSession(options);
});

ipcMain.handle("terminal:write", (_event, payload) => {
  terminalManager.write(payload.id, payload.data);
});

ipcMain.handle("terminal:resize", (_event, payload) => {
  terminalManager.resize(payload.id, payload.cols, payload.rows);
});

ipcMain.handle("terminal:close", (_event, payload) => {
  terminalManager.close(payload.id);
});

ipcMain.handle("dialog:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Choose workspace directory"
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return result.filePaths[0];
});
