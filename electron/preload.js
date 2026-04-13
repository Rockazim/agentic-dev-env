const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adeDesktop", {
  logApp(category, message, details) {
    ipcRenderer.send("app:log", { category, message, details });
  },
  warmVoiceTranscriber() {
    return ipcRenderer.invoke("voice:warmup");
  },
  transcribeVoice(samples, options) {
    return ipcRenderer.invoke("voice:transcribe", { samples, options });
  },
  getRuntimeInfo() {
    return ipcRenderer.invoke("app:get-runtime-info");
  },
  listProfiles() {
    return ipcRenderer.invoke("terminal:list-profiles");
  },
  createTerminal(options) {
    return ipcRenderer.invoke("terminal:create", options);
  },
  writeTerminal(id, data) {
    return ipcRenderer.invoke("terminal:write", { id, data });
  },
  resizeTerminal(id, cols, rows) {
    return ipcRenderer.invoke("terminal:resize", { id, cols, rows });
  },
  closeTerminal(id) {
    return ipcRenderer.invoke("terminal:close", { id });
  },
  onTerminalData(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("terminal:data", wrapped);
    return () => ipcRenderer.removeListener("terminal:data", wrapped);
  },
  onTerminalExit(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("terminal:exit", wrapped);
    return () => ipcRenderer.removeListener("terminal:exit", wrapped);
  },
  onCycleWorkspaceNext(listener) {
    const wrapped = () => listener();
    ipcRenderer.on("workspace:cycle-next", wrapped);
    return () => ipcRenderer.removeListener("workspace:cycle-next", wrapped);
  },
  onOpenTerminalSearch(listener) {
    const wrapped = () => listener();
    ipcRenderer.on("terminal:open-search", wrapped);
    return () => ipcRenderer.removeListener("terminal:open-search", wrapped);
  },
  onVoiceStatus(listener) {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("voice:status", wrapped);
    return () => ipcRenderer.removeListener("voice:status", wrapped);
  },
  pickDirectory() {
    return ipcRenderer.invoke("dialog:pick-directory");
  },
  setReservedHotkeys(payload) {
    return ipcRenderer.invoke("hotkeys:set-reserved", payload);
  }
});
