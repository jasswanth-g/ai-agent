const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qwipoSetup", {
  save: (org, project) => ipcRenderer.invoke("setup:save", { org, project }),
});
