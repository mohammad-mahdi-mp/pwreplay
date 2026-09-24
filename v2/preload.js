const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  openCsv: () => ipcRenderer.invoke('csv:open'),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  savePng: (defaultName, base64) => ipcRenderer.invoke('file:save-png', defaultName, base64)
});
