const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // We can add any Node.js functionality here if needed
  // For now, we'll keep it simple and use browser APIs directly
});