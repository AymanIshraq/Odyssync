// Sidecar bridge: the link between the app and the Python sidecar.
// It listens on ws://127.0.0.1:8089 (the sidecar connects to us), starts the
// sidecar program on Windows and starts it again if it dies, hands the
// sidecar's messages to the app, sends commands back, and tells the sidecar
// which screen edges have a neighbour right now (SET_ACTIVE_EDGES).
const path = require('path');
const childProcess = require('child_process');
const { WebSocketServer } = require('ws');
const { app } = require('electron');
const { sidecarLaunch } = require('./sidecar-launch');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RESTART_MS = 2000;

let server = null; // the WebSocket server
let sidecar = null; // the one connected sidecar socket, or null
let child = null; // the Python process we started, or null
let restartTimer = null; // waiting to start Python again
let stopped = false; // true after stop(): never restart again
let callback = null; // the app's onMessage function
let edges = { left: false, right: false, top: false, bottom: false };
let lastSentEdges = null; // what this connection last got, as text

// Send the remembered edges, but only if this connection has not had them yet.
function sendEdges() {
  const msg = { type: 'SET_ACTIVE_EDGES', ...edges };
  const text = JSON.stringify(msg);
  if (text !== lastSentEdges && send(msg)) lastSentEdges = text;
}

// One message from the sidecar: log it (not the 60-per-second ones), then pass it on.
function handleMessage(data, isBinary) {
  if (!isBinary) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { msg = null; }
    if (!msg || typeof msg !== 'object') {
      console.log('[sidecar] bad message, ignored: ' + data.toString().slice(0, 200).replace(/\s+/g, ' '));
      return;
    }
    if (msg.type !== 'LOCAL_DRAG_MOVE') console.log('[sidecar] ' + JSON.stringify(msg));
    if (callback) callback(msg, null);
    return;
  }
  // Binary message: [uint32 LE header length][JSON header][payload bytes].
  let header, payload;
  try {
    const headerLength = data.readUInt32LE(0);
    if (4 + headerLength > data.length) throw new Error('header longer than frame');
    header = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
    if (!header || typeof header !== 'object') throw new Error('header is not an object');
    payload = data.subarray(4 + headerLength);
  } catch (err) {
    console.log('[sidecar] bad binary frame (' + data.length + ' bytes): ' + err.message);
    return;
  }
  if (callback) callback(header, payload);
}

// Print what Python writes, one line at a time, so its output reads cleanly in our log.
function pipeLines(stream) {
  let rest = '';
  stream.on('data', (chunk) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/);
    rest = lines.pop(); // the last piece may be half a line: keep it for later
    lines.forEach((line) => console.log('[sidecar py] ' + line));
  });
  stream.on('end', () => { if (rest) console.log('[sidecar py] ' + rest); rest = ''; });
}

// Start Python with the sidecar script; when it ends or cannot start, try again in 2 s.
function startProcess() {
  restartTimer = null;
  if (stopped) return;
  let launch;
  try {
    launch = sidecarLaunch({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot: REPO_ROOT });
  } catch (err) {
    console.log('[sidecar] ' + err.message);
    return;
  }
  console.log('[sidecar] starting ' + launch.command);
  const proc = childProcess.spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    windowsHide: true, // no console window
    env: { ...process.env, PYTHONUNBUFFERED: '1' }, // Python prints at once, not in big chunks
  });
  child = proc;
  pipeLines(proc.stdout);
  pipeLines(proc.stderr);
  let ended = false;
  const finish = (why) => {
    if (ended) return; // 'error' and 'exit' can both come for one process
    ended = true;
    if (child === proc) child = null;
    console.log('[sidecar] python ' + why + (stopped ? '' : ', starting it again in 2 s'));
    if (!stopped) restartTimer = setTimeout(startProcess, RESTART_MS);
  };
  proc.on('error', (err) => finish('could not start: ' + err.message));
  proc.on('exit', (code, signal) => finish('exited (' + (signal || 'code ' + code) + ')'));
}

function start() {
  server = new WebSocketServer({ host: '127.0.0.1', port: 8089 });

  // A failed listen (most often: another copy of the app holds the port) lands here.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('[sidecar] port 8089 is busy, bridge not started (is another copy of Odyssync running?)');
    } else {
      console.log('[sidecar] bridge error: ' + err.message);
    }
  });

  // Start Python only once we own the port, so two copies never start two sidecars.
  server.on('listening', () => {
    if (process.platform !== 'win32') console.log('[sidecar] not Windows, sidecar not started');
    else startProcess();
  });

  server.on('connection', (socket) => {
    // Only one sidecar at a time: a new one replaces the old one, quietly.
    if (sidecar) { const old = sidecar; sidecar = null; old.terminate(); }
    sidecar = socket;
    lastSentEdges = null;
    console.log('[sidecar] connected');
    socket.on('close', () => {
      if (socket !== sidecar) return; // an old, replaced socket: not our news
      sidecar = null;
      console.log('[sidecar] disconnected');
    });
    socket.on('error', (err) => console.log('[sidecar] socket error: ' + err.message));
    socket.on('message', (data, isBinary) => { if (socket === sidecar) handleMessage(data, isBinary); });
    sendEdges();
  });
}

// For app quit: no more restarts, close the link, then end Python.
// Closing the link makes the sidecar show again any window it had hidden,
// so if Python is running we give it 500 ms for that before we end it.
// done (optional) is called when all of this is finished.
function stop(done) {
  stopped = true;
  clearTimeout(restartTimer);
  restartTimer = null;
  if (sidecar) { const s = sidecar; sidecar = null; s.terminate(); }
  if (server) { server.close(); server = null; }
  const proc = child;
  if (!proc) { if (done) done(); return; } // no Python running: nothing to wait for
  setTimeout(() => {
    if (child === proc) { proc.kill(); child = null; } // still running: end it now
    if (done) done();
  }, 500);
}

// Send one JSON message to the sidecar. false if no sidecar is connected.
function send(msg) {
  if (!sidecar || sidecar.readyState !== sidecar.OPEN) return false;
  sidecar.send(JSON.stringify(msg));
  return true;
}

function setActiveEdges(e) {
  edges = { left: !!e.left, right: !!e.right, top: !!e.top, bottom: !!e.bottom };
  sendEdges();
}

module.exports = {
  start,
  stop,
  send,
  onMessage: (cb) => { callback = cb; },
  isConnected: () => sidecar !== null,
  setActiveEdges,
};
