const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('odyssync', {
  onEvent: (cb) => ipcRenderer.on('overlay-replay:event', (_event, data) => cb(data)),
  ghostSettled: (transferId, rect) => console.log('REPLAY ghostSettled', transferId, JSON.stringify(rect)),
  setInteractive: enabled => ipcRenderer.send('overlay-replay:interactive', enabled),
  answer: (transferId, accepted) => ipcRenderer.send('overlay-replay:answer', { transferId, accepted }),
});
