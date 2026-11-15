const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandoff } = require('./handoff');

// Both state machines exchange their real messages and file bytes. Only OS
// window operations are faked; document_smoke.py exercises those on Windows.
function pair(t, { failOpen = false, failBytes = false, receiverMode = 'collaborative' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssync-handoff-'));
  const peers = {};
  const profile = { screenWidth: 1200, screenHeight: 800, dpiScale: 1, displayName: 'test' };
  for (const [id, other, edge] of [['a', 'b', 'right'], ['b', 'a', 'left']]) {
    const p = peers[id] = { commands: [], events: [], notices: [], received: [], revealed: [] };
    p.state = { self: { deviceId: id, profile }, members: ['a', 'b'].map(deviceId => ({ deviceId, profile })),
      neighbors: { [id]: { [edge]: other } }, modes: { a: 'collaborative', b: receiverMode } };
    p.handoff = createHandoff({
      getState: () => p.state, downloadsDir: path.join(dir, id),
      timeouts: { ghost: 0, documentOpen: 100, fileReply: 500, filePayload: 200, reply: 500 },
      notify: (kind, text) => p.notices.push(text), revealFile: file => p.revealed.push(file),
      bridge: {
        isConnected: () => true, onMessage: callback => { p.fromSidecar = callback; },
        send: message => {
          p.commands.push(message);
          if (message.type === 'OPEN_FILE' || message.type === 'OPEN_URL') {
            p.fromSidecar({ type: failOpen ? 'OPEN_FAILED' : 'WINDOW_PLACED',
              transferId: message.transferId, hwnd: 20, error: 'application unavailable' });
          }
          return true;
        },
      },
      overlay: { send: event => p.events.push(event),
        onGhostSettled: callback => { p.settle = callback; },
        onAnswer: callback => { p.answer = callback; },
        onFileDropped: callback => { p.dropFile = callback; } },
      transport: {
        bufferedAmount: () => 0,
        sendToPeer: (target, message) => {
          peers[target].received.push(message);
          peers[target].handoff.onPeerMessage({ ...message, fromId: id });
          return true;
        },
        sendBinaryToPeer: (target, header, bytes) => {
          if (failBytes) return false;
          peers[target].handoff.onPeerMessage({ ...header, fromId: id }, bytes);
          return true;
        },
      },
    });
  }
  t.after(() => {
    for (const p of Object.values(peers)) { p.state.members = []; p.handoff.roomChanged(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'draft.txt');
  fs.writeFileSync(file, 'Hello café\nsecond line');
  return { ...peers, file, dir };
}

function swipe(p, file, fields = {}) {
  p.fromSidecar({ type: 'LOCAL_DRAG_START', hwnd: 10, kind: 'document', path: file, app: 'notepad.exe', ...fields });
  p.fromSidecar({ type: 'LOCAL_DRAG_MOVE', hwnd: 10, edge: 'RIGHT', protrusionPx: 80, centerRatio: .5, width: 800, height: 600 });
  p.fromSidecar({ type: 'LOCAL_DRAG_END', hwnd: 10, edge: 'RIGHT', cursorAtEdge: true });
}
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

test('document bytes arrive and open in the same app before sender closes', async t => {
  const { a, b, file } = pair(t);
  swipe(a, file);
  assert.deepEqual(a.commands.map(c => c.type), ['HIDE_WINDOW']);
  await tick();
  const open = b.commands.find(c => c.type === 'OPEN_FILE');
  assert.equal(open.app, 'notepad.exe');
  assert.deepEqual(fs.readFileSync(open.path), fs.readFileSync(file));
  assert.equal(path.basename(open.path), 'draft.txt');
  assert.deepEqual(a.commands.map(c => c.type), ['HIDE_WINDOW', 'CLOSE_WINDOW']);
  assert.equal(a.events.at(-1).type, 'PLACED');
});

test('VS Code transfers one file and keeps its project window', async t => {
  const { a, b, file } = pair(t);
  swipe(a, file, { app: 'code.exe' });
  await tick();
  assert.equal(b.commands[0].app, 'code.exe');
  assert.deepEqual(a.commands.map(c => c.type), ['BOUNCE_WINDOW']);
});

test('a tabbed Notepad keeps its other documents', async t => {
  const { a, file } = pair(t);
  swipe(a, file, { keepSource: true });
  await tick();
  assert.deepEqual(a.commands.map(c => c.type), ['BOUNCE_WINDOW']);
  assert.equal(a.events.at(-1).type, 'PLACED');
});

test('missing receiver application restores sender and shows saved file', async t => {
  const { a, b, file } = pair(t, { failOpen: true });
  swipe(a, file);
  await tick();
  assert.deepEqual(a.commands.map(c => c.type), ['HIDE_WINDOW', 'SHOW_WINDOW']);
  assert.equal(b.revealed.length, 1);
  assert.ok(fs.existsSync(b.revealed[0]));
  assert.match(b.notices[0], /could not be opened/);
  assert.equal(a.events.at(-1).type, 'FAILED');
});

test('failed binary send restores the window immediately', t => {
  const { a, b, file } = pair(t, { failBytes: true });
  swipe(a, file);
  assert.deepEqual(a.commands.map(c => c.type), ['HIDE_WINDOW', 'SHOW_WINDOW']);
  assert.equal(b.commands.length, 0);
});

test('detection failure shows an error only on an attempted edge drop', t => {
  const { a, b, file } = pair(t);
  swipe(a, file, { error: 'Save the active document first' });
  assert.deepEqual(a.notices, ['Save the active document first']);
  assert.equal(a.commands.length, 0);
  assert.equal(b.received.length, 0);
});

test('focus mode bounces without sending file bytes', t => {
  const { a, b, file } = pair(t, { receiverMode: 'focus' });
  swipe(a, file);
  assert.deepEqual(a.commands.map(c => c.type), ['BOUNCE_WINDOW']);
  assert.equal(b.commands.length, 0);
  assert.ok(!b.received.some(c => c.type === 'TRANSFER_COMMIT'));
});

test('approval defers auto-open until accepted', async t => {
  const { a, b, file } = pair(t, { receiverMode: 'approval' });
  swipe(a, file);
  await tick();
  assert.equal(b.commands.length, 0);
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  b.answer(commit.transferId, true);
  await tick();
  assert.equal(b.commands[0].type, 'OPEN_FILE');
  assert.equal(a.commands.at(-1).type, 'CLOSE_WINDOW');
});

test('existing Downloads file is not overwritten', async t => {
  const { a, b, file, dir } = pair(t);
  fs.mkdirSync(path.join(dir, 'b'));
  fs.writeFileSync(path.join(dir, 'b', 'draft.txt'), 'existing');
  swipe(a, file);
  await tick();
  assert.equal(path.basename(b.commands[0].path), 'draft (1).txt');
  assert.equal(fs.readFileSync(path.join(dir, 'b', 'draft.txt'), 'utf8'), 'existing');
});

test('ordinary browser transfer still opens a URL', async t => {
  const { a, b } = pair(t);
  swipe(a, null, { kind: undefined, tabCount: 1, url: 'https://example.com/', browser: 'chrome' });
  await tick();
  assert.equal(b.commands[0].type, 'OPEN_URL');
  assert.equal(b.commands[0].url, 'https://example.com/');
});


test('Explorer drop tracks immediate receipt and never reports a later failure', async t => {
  const { a, b, file } = pair(t);
  a.dropFile('RIGHT', file, 1);
  assert.equal(a.events.at(-1).type, 'PLACED');
  assert.deepEqual(fs.readFileSync(b.revealed[0]), fs.readFileSync(file));
  assert.equal(b.commands.length, 0); // ordinary drops are saved, never auto-opened
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(a.notices.length, 0);
});

test('Explorer drop reports a failed payload immediately', t => {
  const { a, b, file } = pair(t, { failBytes: true });
  a.dropFile('RIGHT', file, 1);
  assert.equal(a.events.at(-1).type, 'FAILED');
  assert.ok(a.notices.includes('File was not delivered'));
  assert.equal(b.events.at(-1).type, 'CANCEL');
  assert.equal(b.revealed.length, 0);
});

test('Explorer drop waits for approval and does not save rejected bytes', t => {
  const { a, b, file } = pair(t, { receiverMode: 'approval' });
  a.dropFile('RIGHT', file, 1);
  assert.equal(b.revealed.length, 0);
  b.answer(b.received.find(m => m.type === 'TRANSFER_COMMIT').transferId, false);
  assert.equal(a.events.at(-1).type, 'REJECTED');
  assert.equal(b.revealed.length, 0);
});

test('five-tab browser keeps the 0.1.4 selected-tab behavior through both peers', async t => {
  const { a, b } = pair(t);
  swipe(a, null, { kind: undefined, tabCount: 5, url: 'https://example.com/selected', browser: 'chrome' });
  await tick();
  assert.equal(b.commands.length, 1);
  assert.equal(b.commands[0].url, 'https://example.com/selected');
  assert.ok(Number.isFinite(b.commands[0].expiresAt));
  assert.deepEqual(a.commands.map(c => c.type), ['HIDE_WINDOW', 'CLOSE_WINDOW']);
});
