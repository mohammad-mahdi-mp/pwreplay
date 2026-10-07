const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#131722',
    autoHideMenuBar: true,
    title: 'Market Replay 3',
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

async function openTextFile (event, title, filters) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  try {
    const content = fs.readFileSync(p, 'utf8');
    return { name: path.basename(p), path: p, content };
  } catch (err) {
    return { error: 'Reading the file failed: ' + err.message };
  }
}

ipcMain.handle('csv:open', (event) => openTextFile(event, 'Select candle data file', [
  { name: 'Candle data (CSV/TSV/TXT)', extensions: ['csv', 'tsv', 'txt'] },
  { name: 'All files', extensions: ['*'] }
]));

ipcMain.handle('session:open', (event) => openTextFile(event, 'Open replay session', [
  { name: 'Market Replay session', extensions: ['mrsession', 'json'] },
  { name: 'All files', extensions: ['*'] }
]));

ipcMain.handle('file:save', async (event, defaultName, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { path: res.filePath };
  } catch (err) {
    return { error: 'Saving the file failed: ' + err.message };
  }
});

ipcMain.handle('file:save-png', async (event, defaultName, base64) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (res.canceled || !res.filePath) return null;
  try {
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
    return { path: res.filePath };
  } catch (err) {
    return { error: 'Saving the image failed: ' + err.message };
  }
});
