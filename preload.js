const { contextBridge, ipcRenderer } = require('electron');

// Expose Node.js modules and IPC communication to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // IPC communication for backend processing
  sendToMain: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  
  receiveFromMain: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },
  
  // Audio processing in backend
  processAudioInBackend: (audioData, frequencyData) => {
    return ipcRenderer.invoke('process-audio', { audioData, frequencyData });
  },
  
  // Play chord in backend
  playChordInBackend: (chordData) => {
    ipcRenderer.send('play-chord', chordData);
  },

  // VST Plugin Management
  scanVSTPlugins: () => {
    return ipcRenderer.invoke('scan-vst-plugins');
  },

  getVSTPlugins: () => {
    return ipcRenderer.invoke('get-vst-plugins');
  },

  loadVSTPlugin: (pluginPath) => {
    return ipcRenderer.invoke('load-vst-plugin', pluginPath);
  },

  startVSTProcessing: (pluginPath, sampleRate, bufferSize) => {
    return ipcRenderer.invoke('start-vst-processing', pluginPath, sampleRate, bufferSize);
  },

  stopVSTProcessing: () => {
    return ipcRenderer.invoke('stop-vst-processing');
  },

  getActiveVSTPlugin: () => {
    return ipcRenderer.invoke('get-active-vst-plugin');
  },

  isVSTAvailable: () => {
    return ipcRenderer.invoke('is-vst-available');
  },

  showVSTPluginGUI: () => {
    return ipcRenderer.invoke('show-vst-plugin-gui');
  },

  isVSTPluginLoaded: () => {
    return ipcRenderer.invoke('is-vst-plugin-loaded');
  },

  // VST event listeners
  onVSTStatus: (callback) => {
    ipcRenderer.on('vst-status', (event, message) => callback(message));
  },

  onVSTError: (callback) => {
    ipcRenderer.on('vst-error', (event, message) => callback(message));
  },

  onVSTPluginsScanned: (callback) => {
    ipcRenderer.on('vst-plugins-scanned', (event, plugins) => callback(plugins));
  }
});
