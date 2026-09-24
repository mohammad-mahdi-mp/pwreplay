const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#131722',
    autoHideMenuBar: true,
    title: 'Market Replay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('csv:open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Select candle data file',
    properties: ['openFile'],
    filters: [
      { name: 'Candle data (CSV/TSV/TXT)', extensions: ['csv', 'tsv', 'txt'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  try {
    const content = fs.readFileSync(p, 'utf8');
    return { name: path.basename(p), path: p, content };
  } catch (err) {
    return { error: 'خواندن فایل ناموفق بود: ' + err.message };
  }
});

ipcMain.handle('file:save', async (event, defaultName, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, content, 'utf8');
    return res.filePath;
  } catch (err) {
    return { error: 'ذخیره فایل ناموفق بود: ' + err.message };
  }
});
