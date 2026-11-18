// window.odyssync for the Control Center (contract.md, "Renderer API").
// Every call goes over IPC to room.js in the main process.
const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (arg) => ipcRenderer.invoke('room:' + name, arg);

contextBridge.exposeInMainWorld('odyssync', {
  createRoom: call('createRoom'),
  joinRoom: call('joinRoom'),
  leaveRoom: call('leaveRoom'),
  setLayout: call('setLayout'),
  setMode: call('setMode'),
  kick: call('kick'),
  listSendable: call('listSendable'),
  sendDirect: call('sendDirect'),

  // Every new state, plus the current one right away so the page can draw.
  onState: (cb) => {
    ipcRenderer.on('room:state', (event, state) => cb(state));
    ipcRenderer.invoke('room:getState').then(cb);
  },

  onNotice: (cb) => {
    ipcRenderer.on('room:notice', (event, notice) => cb(notice));
  },
});
