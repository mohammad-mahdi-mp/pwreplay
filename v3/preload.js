const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  version: 3,
  openCsv: () => ipcRenderer.invoke('csv:open'),
  openSession: () => ipcRenderer.invoke('session:open'),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  savePng: (defaultName, base64) => ipcRenderer.invoke('file:save-png', defaultName, base64)
});
