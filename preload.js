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
  }
});
