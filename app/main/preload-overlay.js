// window.odyssync for the overlay (contract.md, "Renderer API" > Overlay).
// The overlay only reacts to events sent from main, so this is already the real
// version: main (later room.js, for now tools/replay.js) sends 'overlay:event'.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('odyssync', {
  // cb(event): PREVIEW, DRAG_MOVE, CANCEL, COMMIT, PLACED, BOUNCE, REJECTED,
  // FAILED, VOICE. Every event has role, this screen's edge, and DIPs.
  onEvent: (cb) => ipcRenderer.on('overlay:event', (_e, event) => cb(event)),

  // true = the overlay catches clicks (Approval card); false = click-through.
  setInteractive: (on) => ipcRenderer.send('overlay:setInteractive', on),

  // Approval card answer.
  answer: (transferId, accepted) => ipcRenderer.send('overlay:answer', transferId, accepted),

  // Where the ghost card ended, so the real window opens on the same spot.
  ghostSettled: (transferId, rect) => ipcRenderer.send('overlay:ghostSettled', transferId, rect),

  // Voice send menu answer: { itemIds: [...] | null, deviceId: string | null }, or null when cancelled.
  sendMenuAnswer: (requestId, answer) => ipcRenderer.send('overlay:sendMenuAnswer', requestId, answer),

  // A file dropped on the drop strip: main gets its path on disk and how many files were dropped.
  fileDropped: (edge, file, count) => ipcRenderer.send('overlay:fileDropped', edge, webUtils.getPathForFile(file), count),
});
