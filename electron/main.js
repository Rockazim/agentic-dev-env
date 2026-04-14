const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } = require("electron");
const { TerminalManager } = require("./terminal-manager");
const { VoiceTranscriber } = require("./voice-transcriber");

const isMac = process.platform === "darwin";
const rendererEntryPath = path.join(__dirname, "..", "index.html");
const rendererEntryUrl = pathToFileURL(rendererEntryPath).href;
let mainWindow = null;
let terminalManager = null;
let voiceTranscriber = null;
let reservedHotkeys = {
  nextWorkspace: {
    code: "Tab",
    primary: true,
    alt: false,
    shift: false
  },
  findTerminal: {
    code: "KeyF",
    primary: true,
    alt: false,
    shift: false
  }
};

function formatDetails(details) {
  if (details == null) {
    return "";
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.agenticdevenv.desktop");
}

nativeTheme.themeSource = "dark";

function isTrustedRendererUrl(url) {
  return url === rendererEntryUrl;
}

function isTrustedSender(senderFrame) {
  return isTrustedRendererUrl(senderFrame?.url || "");
}

function assertTrustedSender(senderFrame) {
  if (!isTrustedSender(senderFrame)) {
    throw new Error(`Blocked IPC from untrusted renderer: ${senderFrame?.url || "unknown"}`);
  }
}

function normalizeReservedHotkey(binding) {
  if (binding == null) {
    return null;
  }

  if (typeof binding !== "object" || typeof binding.code !== "string" || !binding.code) {
    return null;
  }

  return {
    code: binding.code,
    primary: Boolean(binding.primary),
    alt: Boolean(binding.alt),
    shift: Boolean(binding.shift)
  };
}

function syncReservedHotkeys(payload = {}) {
  reservedHotkeys = {
    nextWorkspace: normalizeReservedHotkey(payload.nextWorkspace),
    findTerminal: normalizeReservedHotkey(payload.findTerminal)
  };
}

function matchesReservedHotkey(binding, input) {
  if (!binding || input.type !== "keyDown" || input.isAutoRepeat || input.code !== binding.code) {
    return false;
  }

  const primaryPressed = Boolean(input.control || input.meta);
  return (
    primaryPressed === binding.primary &&
    Boolean(input.alt) === binding.alt &&
    Boolean(input.shift) === binding.shift
  );
}

function showContextMenu(params) {
  const canCopy = Boolean(params.selectionText) || Boolean(params.editFlags?.canCopy);
  const canPaste = Boolean(params.isEditable && params.editFlags?.canPaste);

  if (!canCopy && !canPaste) {
    return;
  }

  const template = [];

  if (canCopy) {
    template.push({ role: "copy" });
  }

  if (canPaste) {
    template.push({ role: "paste" });
  }

  // xterm prepares a focused hidden textarea on right click, so native edit
  // roles here can copy terminal selections and paste back into the PTY.
  Menu.buildFromTemplate(template).popup({
    window: mainWindow
  });
}

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
      sandbox: true
    }
  });

  mainWindow.loadFile(rendererEntryPath);

  mainWindow.webContents.on("will-navigate", event => {
    event.preventDefault();
  });

  mainWindow.webContents.on("context-menu", (_event, params) => {
    showContextMenu(params);
  });

  // Catch browser-reserved shortcuts before Chromium consumes them.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (matchesReservedHotkey(reservedHotkeys.nextWorkspace, input)) {
      event.preventDefault();
      mainWindow?.webContents.send("workspace:cycle-next");
      return;
    }

    if (matchesReservedHotkey(reservedHotkeys.findTerminal, input)) {
      event.preventDefault();
      mainWindow?.webContents.send("terminal:open-search");
      return;
    }

    // DevTools toggle — the application menu is suppressed on non-Mac, which
    // removes the default Ctrl+Shift+I accelerator. Re-add it here so we can
    // inspect the renderer during development.
    if (
      input.type === "keyDown" &&
      input.key === "I" &&
      input.shift &&
      (isMac ? input.meta && input.alt : input.control)
    ) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
      return;
    }

    if (input.type === "keyDown" && input.key === "F12") {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);

      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        shell.openExternal(url);
      }
    } catch {
      // Ignore malformed URLs and deny the window creation below.
    }

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

  voiceTranscriber = new VoiceTranscriber({
    cacheDir: path.join(app.getPath("userData"), "voice-model-cache"),
    sendToRenderer(channel, payload) {
      mainWindow?.webContents.send(channel, payload);
    }
  });

  return mainWindow;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed =
      isTrustedRendererUrl(webContents.getURL()) &&
      (permission === "media" || permission === "audioCapture");
    console.log(`[permissions] request ${permission} -> ${allowed ? "allow" : "deny"}`);
    callback(allowed);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (
      isTrustedRendererUrl(webContents.getURL()) &&
      (permission === "media" || permission === "audioCapture")
    ) {
      console.log(`[permissions] check ${permission} -> allow`);
      return true;
    }

    return false;
  });

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

ipcMain.handle("terminal:list-profiles", event => {
  assertTrustedSender(event.senderFrame);
  return terminalManager?.listProfiles() || [];
});

ipcMain.handle("terminal:create", (event, options) => {
  assertTrustedSender(event.senderFrame);
  return terminalManager.createSession(options);
});

ipcMain.handle("terminal:write", (event, payload) => {
  assertTrustedSender(event.senderFrame);
  terminalManager.write(payload.id, payload.data);
});

ipcMain.handle("terminal:resize", (event, payload) => {
  assertTrustedSender(event.senderFrame);
  terminalManager.resize(payload.id, payload.cols, payload.rows);
});

ipcMain.handle("terminal:close", (event, payload) => {
  assertTrustedSender(event.senderFrame);
  terminalManager.close(payload.id);
});

ipcMain.handle("dialog:pick-directory", async event => {
  assertTrustedSender(event.senderFrame);
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Choose workspace directory"
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("hotkeys:set-reserved", (event, payload) => {
  assertTrustedSender(event.senderFrame);
  syncReservedHotkeys(payload);
});

ipcMain.handle("voice:warmup", async event => {
  assertTrustedSender(event.senderFrame);
  return voiceTranscriber.warmup();
});

ipcMain.handle("voice:transcribe", async (event, payload) => {
  assertTrustedSender(event.senderFrame);
  return voiceTranscriber.transcribe(payload);
});

ipcMain.on("app:log", (event, payload = {}) => {
  if (!isTrustedSender(event.senderFrame)) {
    return;
  }

  const category = payload.category || "app";
  const message = payload.message || "";
  const details = formatDetails(payload.details);
  const suffix = details ? ` ${details}` : "";
  console.log(`[renderer:${category}] ${message}${suffix}`);
});
