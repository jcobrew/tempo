const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  isDesktop: true,
  getDesktopCapabilities: () => ipcRenderer.invoke("desktop:get-capabilities"),
  getMiniAlwaysOnTop: () => ipcRenderer.invoke("window:get-mini-always-on-top"),
  setMiniAlwaysOnTop: (shouldPin) =>
    ipcRenderer.invoke("window:set-mini-always-on-top", shouldPin),
  getScreenPermissionStatus: () => ipcRenderer.invoke("strict:get-screen-permission-status"),
  requestScreenPermission: () => ipcRenderer.invoke("strict:request-screen-permission"),
  openScreenPermissionSettings: () =>
    ipcRenderer.invoke("strict:open-screen-permission-settings"),
  captureVisionFrame: (options) => ipcRenderer.invoke("strict:capture-vision-frame", options),
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
