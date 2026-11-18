// Run after building, with all other Odyssync copies closed:
// node tools/smoke-windows.cjs
// Opens the real portable EXE, creates/leaves a temporary relay room, then quits.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');
const { randomBytes } = require('node:crypto');
const WebSocket = require('../app/node_modules/ws');
const config = require('../app/config.json');
const { version } = require('../app/package.json');

const executable = path.resolve(__dirname, '../dist/windows/Odyssync-' + version + '-portable.exe');
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(path|pythonhome|pythonpath|electron_run_as_node)$/i.test(key)));
env.Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const child = spawn(executable, ['--remote-debugging-port=9339'], { env, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; });
  let control;
  for (let attempt = 0; attempt < 60 && !control; attempt++) {
    if (launchError) throw launchError;
    try {
      const pages = await fetch('http://127.0.0.1:9339/json/list').then(reply => reply.json());
      control = pages.find(page => page.url.endsWith('/control/index.html') && page.url.includes('/app.asar/'));
    } catch { /* Portable extraction and Chromium startup take a few seconds. */ }
    if (!control) await delay(500);
  }
  assert.ok(control, 'Packaged Control Center did not start in 30 seconds');
  const socket = new WebSocket(control.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let nextId = 0;
  const pending = new Map();
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    assert.equal(await evaluate('typeof window.odyssync.createRoom'), 'function');
    const room = await evaluate("window.odyssync.createRoom('Packaged smoke test')");
    assert.match(room.roomNumber, /^\d{6}$/);
    assert.match(room.pin, /^\d{4}$/);
    const state = await evaluate('new Promise(resolve => window.odyssync.onState(resolve))');
    assert.ok(state.isHost, 'Packaged app did not become host');
    const peer = new WebSocket(config.relayUrl, { handshakeTimeout: 10000 });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Relay join timed out')), 15000);
        peer.once('error', error => { clearTimeout(timer); reject(error); });
        peer.once('open', () => peer.send(JSON.stringify({ type: 'JOIN_ROOM',
          fromId: randomBytes(4).toString('hex'), toId: '*', mid: 1,
          roomNumber: room.roomNumber, pin: room.pin,
          profile: { displayName: 'Build verification', screenWidth: 800, screenHeight: 600, dpiScale: 1 },
        })));
        peer.on('message', bytes => {
          const message = JSON.parse(bytes.toString());
          if (message.type === 'JOIN_ACCEPTED') { clearTimeout(timer); resolve(); }
          if (message.type === 'JOIN_REJECTED') { clearTimeout(timer); reject(new Error(message.reason)); }
        });
      });
    } finally { peer.close(); }
    console.log('Portable EXE loaded its Control Center/preload, hosted a relay room, and accepted a relay peer.');
    console.log('Child process PATH contains only Windows System32; no Node or Python directories.');
    // Keep the app open briefly so the bridge/helper handshake can finish.
    await delay(2000);
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const helpers = execFileSync(powershell, ['-NoProfile', '-Command',
      'Get-CimInstance Win32_Process -Filter "name = \'odyssync-sidecar.exe\'" | Select-Object -ExpandProperty ExecutablePath'],
      { encoding: 'utf8', windowsHide: true });
    const bundledHelper = path.resolve(path.dirname(fileURLToPath(control.url)), '../../sidecar/odyssync-sidecar.exe');
    assert.ok(helpers.split(/\r?\n/).some(file => file.trim().toLowerCase() === bundledHelper.toLowerCase()),
      'The portable app did not start its bundled native helper');
    console.log('The portable app is running its extracted, bundled helper executable.');
  } finally {
    try { await evaluate('window.odyssync.leaveRoom()'); } finally {
      try { await command('Page.close'); } finally { socket.close(); }
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
