const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adeDesktop", {
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
  pickDirectory() {
    return ipcRenderer.invoke("dialog:pick-directory");
  }
});
