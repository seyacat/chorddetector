const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const VSTManager = require('./vst-manager');

let vstManager = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 850,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  
  // Always open DevTools for debugging
  mainWindow.webContents.openDevTools();

  // Initialize VST manager
  vstManager = new VSTManager();
  
  // Set up VST manager callbacks
  vstManager.onStatus((message) => {
    mainWindow.webContents.send('vst-status', message);
  });

  vstManager.onError((message) => {
    mainWindow.webContents.send('vst-error', message);
  });

  // Scan for VST plugins on startup
  setTimeout(() => {
    vstManager.scanVSTPlugins().then(plugins => {
      mainWindow.webContents.send('vst-plugins-scanned', plugins);
    });
  }, 1000);
}

// IPC handlers for VST functionality
ipcMain.handle('scan-vst-plugins', async () => {
  if (vstManager) {
    return await vstManager.scanVSTPlugins();
  }
  return [];
});

ipcMain.handle('get-vst-plugins', async () => {
  if (vstManager) {
    return vstManager.getAvailablePlugins();
  }
  return [];
});

ipcMain.handle('load-vst-plugin', async (event, pluginPath) => {
  if (vstManager) {
    return await vstManager.loadPlugin(pluginPath);
  }
  return false;
});

ipcMain.handle('start-vst-processing', async (event, pluginPath, sampleRate, bufferSize) => {
  if (vstManager) {
    return await vstManager.startVSTProcessing(pluginPath, sampleRate, bufferSize);
  }
  return false;
});

ipcMain.handle('stop-vst-processing', async () => {
  if (vstManager) {
    return await vstManager.stopVSTProcessing();
  }
  return false;
});

ipcMain.handle('get-active-vst-plugin', async () => {
  if (vstManager) {
    return vstManager.getActivePlugin();
  }
  return null;
});

ipcMain.handle('is-vst-available', async () => {
  if (vstManager) {
    return vstManager.isVSTAvailable();
  }
  return false;
});

ipcMain.handle('show-vst-plugin-gui', async () => {
  if (vstManager) {
    return await vstManager.showPluginGUI();
  }
  return false;
});

ipcMain.handle('is-vst-plugin-loaded', async () => {
  if (vstManager) {
    return vstManager.isPluginLoaded();
  }
  return false;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});