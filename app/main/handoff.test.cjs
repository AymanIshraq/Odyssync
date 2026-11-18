const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandoff } = require('./handoff');

// Both state machines exchange their real messages and file bytes. Only OS
// window operations are faked; document_smoke.py exercises those on Windows.
function pair(t, { failOpen = false, failBytes = false, receiverMode = 'collaborative', sidecar = () => null, unreachable = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssync-handoff-'));
  const peers = {};
  const profile = { screenWidth: 1200, screenHeight: 800, dpiScale: 1, displayName: 'test' };
  for (const [id, other, edge] of [['a', 'b', 'right'], ['b', 'a', 'left']]) {
    const p = peers[id] = { commands: [], events: [], notices: [], received: [], revealed: [] };
    p.state = { self: { deviceId: id, profile }, members: ['a', 'b'].map(deviceId => ({ deviceId, profile })),
      neighbors: { [id]: { [edge]: other } }, modes: { a: 'collaborative', b: receiverMode } };
    p.handoff = createHandoff({
      getState: () => p.state, downloadsDir: path.join(dir, id),
      timeouts: { ghost: 0, documentOpen: 100, fileReply: 500, filePayload: 200, reply: 500, lookup: 50 },
      notify: (kind, text) => p.notices.push(text), revealFile: file => p.revealed.push(file),
      bridge: {
        isConnected: () => true, onMessage: callback => { p.fromSidecar = callback; },
        send: message => {
          p.commands.push(message);
          if (message.type === 'OPEN_FILE' || message.type === 'OPEN_URL') {
            p.fromSidecar({ type: failOpen ? 'OPEN_FAILED' : 'WINDOW_PLACED',
              transferId: message.transferId, hwnd: 20, error: 'application unavailable' });
          }
          const answer = id === 'a' && sidecar(message);
          if (answer) setTimeout(() => p.fromSidecar(answer), 0);
          return true;
        },
      },
      overlay: { send: event => p.events.push(event),
        onGhostSettled: callback => { p.settle = callback; },
        onAnswer: callback => { p.answer = callback; } },
      transport: {
        bufferedAmount: () => 0,
        sendToPeer: (target, message) => {
          if (unreachable) return false;
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

// ---------- right-click: "Select to send" ----------

const WINDOWS = [
  { hwnd: 1, kind: 'browser', app: 'chrome.exe', title: 'Example Domain - Google Chrome' },
  { hwnd: 2, kind: 'app', app: 'notepad.exe', title: 'notes.txt - Notepad' },
  { hwnd: 3, kind: 'app', app: 'winword.exe', title: 'Report.docx - Word' },
  { hwnd: 4, kind: 'app', app: 'code.exe', title: '● app.js - proj - Visual Studio Code' },
  { hwnd: 13, kind: 'explorer', app: 'explorer.exe', title: 'Downloads', names: ['photo.png', 'notes.pdf'] },
  { hwnd: 6, kind: 'app', app: 'acrord32.exe', title: 'Adobe Acrobat Reader' },
  { hwnd: 7, kind: 'browser', app: 'chrome.exe', title: 'Node.js - Google Chrome' },
];
const WINDOW_COMMANDS = ['HIDE_WINDOW', 'CLOSE_WINDOW', 'SHOW_WINDOW', 'BOUNCE_WINDOW'];
const lister = (reply) => (m) => (m.type === 'LIST_OPEN_WINDOWS' ? { type: 'OPEN_WINDOWS', ...reply } : null);
const itemer = (item) => (m) => (m.type === 'GET_WINDOW_ITEM' ? { type: 'WINDOW_ITEM', hwnd: m.hwnd, ...item } : null);
const noWindowCommands = (p) => assert.ok(!p.commands.some(c => WINDOW_COMMANDS.includes(c.type)));

test('list maps open windows to names, badges and details', async t => {
  const { a } = pair(t, { sidecar: lister({ windows: WINDOWS }) });
  const r = await a.handoff.listSendable('b');
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [
    { id: '1', kind: 'tab', badge: 'WEB', name: 'Example Domain', detail: 'Chrome tab' },
    { id: '2', kind: 'document', badge: 'TXT', name: 'notes.txt', detail: 'Open in Notepad' },
    { id: '3', kind: 'document', badge: 'DOCX', name: 'Report.docx', detail: 'Open in Word' },
    { id: '4', kind: 'document', badge: 'JS', name: 'app.js', detail: 'Open in VS Code' },
    { id: '13/photo.png', kind: 'file', badge: 'PNG', name: 'photo.png', detail: 'Selected in File Explorer' },
    { id: '13/notes.pdf', kind: 'file', badge: 'PDF', name: 'notes.pdf', detail: 'Selected in File Explorer' },
    { id: '6', kind: 'document', badge: 'FILE', name: 'Adobe Acrobat Reader', detail: 'Open in acrord32' },
    { id: '7', kind: 'tab', badge: 'WEB', name: 'Node.js', detail: 'Chrome tab' },
  ]);
  assert.deepEqual(a.commands.map(c => c.type), ['LIST_OPEN_WINDOWS']);
});

test('list: explorer window on the Desktop', async t => {
  const { a } = pair(t, { sidecar: lister({ windows: [{ hwnd: 65552, kind: 'explorer', where: 'desktop', app: 'explorer.exe', title: 'Desktop', names: ['report.docx'] }] }) });
  const r = await a.handoff.listSendable('b');
  assert.deepEqual(r.items, [
    { id: '65552/report.docx', kind: 'file', badge: 'DOCX', name: 'report.docx', detail: 'Selected on the Desktop' },
  ]);
});

test('list: empty, error, timeout', async t => {
  let reply = { windows: [] };
  const { a } = pair(t, { sidecar: m => (m.type === 'LIST_OPEN_WINDOWS' && reply ? { type: 'OPEN_WINDOWS', ...reply } : null) });
  assert.deepEqual(await a.handoff.listSendable('b'), { ok: false, error: 'Open a browser tab, document or File Explorer window first' });
  reply = { error: 'Access denied' };
  assert.deepEqual(await a.handoff.listSendable('b'), { ok: false, error: 'Access denied' });
  reply = null;
  assert.deepEqual(await a.handoff.listSendable('b'), { ok: false, error: 'Could not read your open windows' });
});

test('list guards: not a member, focus, busy', async t => {
  const { a } = pair(t, { receiverMode: 'focus', sidecar: lister({ windows: WINDOWS }) });
  assert.deepEqual(await a.handoff.listSendable('zz'), { ok: false, error: 'That laptop is not in the room' });
  assert.deepEqual(await a.handoff.listSendable('b'), { ok: false, error: 'test is in Focus mode' });
  a.state.modes.b = 'collaborative';
  const first = a.handoff.listSendable('b');
  assert.deepEqual(await a.handoff.sendDirect('b', '1'), { ok: false, error: 'Still working on your last send' });
  assert.equal((await first).ok, true);
});

test('send tab: direct tab commit, opens there, our window untouched', async t => {
  const { a, b } = pair(t, { sidecar: itemer({ kind: 'tab', url: 'https://example.com/', title: 'Example', browser: 'chrome', tabCount: 3 }) });
  const r = await a.handoff.sendDirect('b', '1');
  assert.deepEqual(r, { ok: true, what: 'tab' });
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  assert.equal(commit.kind, 'tab');
  assert.equal(commit.direct, true);
  assert.equal(commit.edge, 'RIGHT');
  assert.equal(commit.url, 'https://example.com/');
  assert.equal(b.commands[0].type, 'OPEN_URL');
  assert.deepEqual(a.commands.map(c => c.type), ['GET_WINDOW_ITEM']);
  assert.equal(a.commands[0].hwnd, 1);
  assert.equal(a.events.length, 0);
});

test('send document: file commit with open and app, then exact bytes', async t => {
  let file;
  const { a, b, file: f } = pair(t, { sidecar: m => itemer({ kind: 'document', path: file, title: 'draft.txt - Notepad', app: 'notepad.exe' })(m) });
  file = f;
  const r = await a.handoff.sendDirect('b', '2');
  assert.deepEqual(r, { ok: true, what: 'document' });
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  assert.equal(commit.kind, 'file');
  assert.equal(commit.open, true);
  assert.equal(commit.direct, true);
  assert.equal(commit.app, 'notepad.exe');
  assert.equal(commit.filename, 'draft.txt');
  const open = b.commands.find(c => c.type === 'OPEN_FILE');
  assert.deepEqual(fs.readFileSync(open.path), fs.readFileSync(file));
  noWindowCommands(a);
  assert.equal(a.events.length, 0);
});

test('send Explorer file: saved, not opened', async t => {
  let file;
  const { a, b, file: f } = pair(t, { sidecar: m => itemer({ kind: 'file', path: file, name: m.name, size: 10 })(m) });
  file = f;
  assert.deepEqual(await a.handoff.sendDirect('b', '13/notes.pdf'), { ok: true, what: 'file' });
  assert.equal(a.commands[0].hwnd, 13);
  assert.equal(a.commands[0].name, 'notes.pdf');
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  assert.equal(commit.open, undefined);
  assert.equal(commit.app, undefined);
  assert.equal(commit.width, 320);
  assert.equal(b.revealed.length, 1);
  assert.deepEqual(fs.readFileSync(b.revealed[0]), fs.readFileSync(file));
  noWindowCommands(a);
});

test('a file: URL tab is sent as a document', async t => {
  let file;
  const { a, b, file: f } = pair(t, { sidecar: m => itemer({ kind: 'tab', url: require('url').pathToFileURL(file).href, title: 'draft.txt', browser: 'chrome', tabCount: 1 })(m) });
  file = f;
  const r = await a.handoff.sendDirect('b', '1');
  noWindowCommands(a);
  // The URL becomes a Windows path (backslashes), which only Windows can read.
  if (process.platform !== 'win32') return assert.deepEqual(r, { ok: false, error: 'Could not read that file' });
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  assert.equal(commit.kind, 'file');
  assert.equal(commit.open, true);
  assert.equal(commit.app, undefined);
  assert.equal(commit.filename, 'draft.txt');
  assert.deepEqual(r, { ok: true, what: 'document' });
});

test('send: item error, other scheme, unreachable, rejected', async t => {
  let item = { error: 'That window is gone' };
  const { a, b } = pair(t, { receiverMode: 'approval', sidecar: m => itemer(item)(m) });
  assert.deepEqual(await a.handoff.sendDirect('b', '9'), { ok: false, error: 'That window is gone' });
  item = { kind: 'tab', url: 'javascript:alert(1)', title: 'X', browser: 'chrome', tabCount: 1 };
  assert.deepEqual(await a.handoff.sendDirect('b', '9'), { ok: false, error: "This tab can't be sent" });
  assert.equal(b.received.some(c => c.type === 'TRANSFER_COMMIT'), false);
  item = { kind: 'tab', url: 'https://example.com/', title: 'Example', browser: 'chrome', tabCount: 1 };
  const pending = a.handoff.sendDirect('b', '9');
  await tick();
  const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
  b.answer(commit.transferId, false);
  assert.deepEqual(await pending, { ok: false, error: 'test declined the tab' });
  noWindowCommands(a);
});

test('send tab: browser pages are sent as tabs', async t => {
  for (const [url, browser] of [['chrome://newtab/', 'chrome'], ['edge://settings/', 'edge']]) {
    const { a, b } = pair(t, { sidecar: itemer({ kind: 'tab', url, title: 'T', browser, tabCount: 1 }) });
    assert.deepEqual(await a.handoff.sendDirect('b', '1'), { ok: true, what: 'tab' });
    const commit = b.received.find(c => c.type === 'TRANSFER_COMMIT');
    assert.equal(commit.kind, 'tab');
    assert.equal(commit.url, url);
    assert.equal(commit.browser, browser);
  }
});

test('send: garbled item id is refused', async t => {
  const { a } = pair(t);
  for (const bad of [5, null, '', 'abc', 'x/y'])
    assert.deepEqual(await a.handoff.sendDirect('b', bad), { ok: false, error: 'Could not read that window' });
  assert.equal(a.commands.length, 0);
});

test('send: unreachable laptop and helper timeout', async t => {
  const { a } = pair(t, { unreachable: true, sidecar: itemer({ kind: 'tab', url: 'https://example.com/', title: 'E', browser: 'chrome', tabCount: 1 }) });
  assert.deepEqual(await a.handoff.sendDirect('b', '1'), { ok: false, error: 'Could not reach that laptop' });
  const { a: a2 } = pair(t);
  assert.deepEqual(await a2.handoff.sendDirect('b', '1'), { ok: false, error: 'Could not read that window' });
});

// ---------- voice: what is open now ----------

const current = (reply) => (m) => (m.type === 'GET_CURRENT_ITEM' && reply ? { type: 'CURRENT_ITEM', ...reply } : null);

test('readCurrent: tab, document, files, error, timeout', async t => {
  let reply = { kind: 'tab', url: 'https://example.com/', title: 'Example', browser: 'chrome', tabCount: 2 };
  const { a } = pair(t, { sidecar: m => current(reply)(m) });
  assert.deepEqual(await a.handoff.readCurrent(), { ok: true, label: 'Example',
    items: [{ kind: 'tab', url: 'https://example.com/', title: 'Example', browser: 'chrome' }] });
  assert.equal(a.commands[0].type, 'GET_CURRENT_ITEM');
  reply = { kind: 'document', path: 'C:\\Users\\me\\notes.txt', title: 'notes.txt - Notepad', app: 'notepad.exe' };
  assert.deepEqual(await a.handoff.readCurrent(), { ok: true, label: 'notes.txt',
    items: [{ kind: 'document', path: 'C:\\Users\\me\\notes.txt', title: 'notes.txt - Notepad', app: 'notepad.exe' }] });
  reply = { kind: 'files', where: 'explorer', files: [{ path: 'C:\\d\\a.png', name: 'a.png', size: 1 }, { path: 'C:\\d\\b.pdf', name: 'b.pdf', size: 2 }] };
  assert.deepEqual(await a.handoff.readCurrent(), { ok: true, label: '2 files',
    items: [{ kind: 'file', path: 'C:\\d\\a.png', name: 'a.png' }, { kind: 'file', path: 'C:\\d\\b.pdf', name: 'b.pdf' }] });
  reply = { error: 'Nothing is open' };
  assert.deepEqual(await a.handoff.readCurrent(), { ok: false, error: 'Nothing is open' });
  reply = null;
  assert.deepEqual(await a.handoff.readCurrent(), { ok: false, error: 'Could not read what is open' });
});

test('readCurrent: busy', async t => {
  const { a } = pair(t, { sidecar: current({ kind: 'tab', url: 'https://e.com/', title: 'E', browser: 'chrome', tabCount: 1 }) });
  const first = a.handoff.readCurrent();
  assert.deepEqual(await a.handoff.readCurrent(), { ok: false, error: 'Still working on your last send' });
  assert.equal((await first).ok, true);
});

test('sendItems: two items in order with counts', async t => {
  const { a, b, file } = pair(t);
  const r = await a.handoff.sendItems('b', [
    { kind: 'tab', url: 'https://example.com/', title: 'Example', browser: 'chrome' },
    { kind: 'file', path: file, name: 'draft.txt' },
  ]);
  assert.deepEqual(r, { ok: true, sent: 2, total: 2, what: 'items', error: undefined });
  const commits = b.received.filter(c => c.type === 'TRANSFER_COMMIT');
  assert.deepEqual(commits.map(c => c.kind), ['tab', 'file']);
  assert.deepEqual(fs.readFileSync(b.revealed[0]), fs.readFileSync(file));
  const bad = await a.handoff.sendItems('b', [{ kind: 'tab', url: 'javascript:x' }, { kind: 'tab', url: 'https://e.com/' }]);
  assert.deepEqual(bad, { ok: false, sent: 1, total: 2, what: 'items', error: "This tab can't be sent" });
});

test('sendCurrent: reads then sends a selected file', async t => {
  let file;
  const { a, b, file: f } = pair(t, { sidecar: m => current({ kind: 'files', where: 'desktop', files: [{ path: file, name: 'draft.txt', size: 5 }] })(m) });
  file = f;
  assert.deepEqual(await a.handoff.sendCurrent('b'), { ok: true, sent: 1, total: 1, what: 'file', error: undefined });
  assert.deepEqual(fs.readFileSync(b.revealed[0]), fs.readFileSync(file));
  noWindowCommands(a);
});
