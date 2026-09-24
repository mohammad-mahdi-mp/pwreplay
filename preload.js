const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  openCsv: () => ipcRenderer.invoke('csv:open'),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content)
});
