// window.odyssyncVoice for the hidden Voice window (app/voice/).
// The page only talks to main through these five calls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('odyssyncVoice', {
  // { agentId, accessKey, keywordPath, modelPath }; paths are file:// URLs or ''.
  getConfig: () => ipcRenderer.invoke('voice:getConfig'),

  // The agent called a tool; main does the work and the answer goes back to the agent.
  tool: (name, params) => ipcRenderer.invoke('voice:tool', name, params),

  // 'idle' | 'listening' | 'thinking' | 'speaking'
  setState: (state) => ipcRenderer.send('voice:state', state),

  // A short message for the user (no mic, no internet, not set up).
  notice: (text) => ipcRenderer.send('voice:notice', text),

  // The voice hotkey was pressed: start a session, or end the running one.
  onStart: (cb) => ipcRenderer.on('voice:start', () => cb()),
});
