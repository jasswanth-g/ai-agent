const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qwipoSetup", {
  save: (org, project, servicesUrl) => ipcRenderer.invoke("setup:save", { org, project, servicesUrl }),
});
