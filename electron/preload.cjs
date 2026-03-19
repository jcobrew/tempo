const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  isDesktop: true,
  getMiniAlwaysOnTop: () => ipcRenderer.invoke("window:get-mini-always-on-top"),
  setMiniAlwaysOnTop: (shouldPin) =>
    ipcRenderer.invoke("window:set-mini-always-on-top", shouldPin),
  getScreenPermissionStatus: () => ipcRenderer.invoke("strict:get-screen-permission-status"),
  openScreenPermissionSettings: () =>
    ipcRenderer.invoke("strict:open-screen-permission-settings"),
  getActiveContext: () => ipcRenderer.invoke("strict:get-active-context"),
  updateMiniState: (state) => ipcRenderer.send("mini:update-state", state),
  getMiniState: () => ipcRenderer.invoke("mini:get-state"),
  sendMiniControl: (command) => ipcRenderer.send("mini:control", command),
  onMiniState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("mini:state", listener);
    return () => ipcRenderer.removeListener("mini:state", listener);
  },
  onMiniCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("mini:command", listener);
    return () => ipcRenderer.removeListener("mini:command", listener);
  },
});
