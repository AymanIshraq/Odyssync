const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createVoice, summary } = require('./voice');

// Fakes for Electron and the room manager. `people` = other members: [name, mode].
function setup({ people = [['Rafi', 'collaborative'], ['Charlie', 'collaborative']], inRoom = true, current, sendable, failIds = [] } = {}) {
  const handlers = {}, listeners = {}, events = [], calls = [], shortcuts = {};
  let answerCb = null;
  const members = [{ deviceId: 'me', profile: { displayName: 'Me' } }, ...people.map(([name], i) => ({ deviceId: 'd' + i, profile: { displayName: name } }))];
  const modes = { me: 'collaborative' };
  people.forEach(([, mode], i) => { modes['d' + i] = mode; });
  const manager = {
    getState: () => ({ self: { deviceId: 'me' }, roomNumber: inRoom ? '123456' : null, members: inRoom ? members : [], modes: inRoom ? modes : {} }),
    setMode: (m) => calls.push(['setMode', m]),
    listSendable: async (id) => { calls.push(['listSendable', id]); return sendable || { ok: true, items: [
      { id: '11', kind: 'tab', badge: 'WEB', name: 'Example', detail: 'Chrome' },
      { id: '12', kind: 'document', badge: 'TXT', name: 'notes.txt', detail: 'Notepad' },
      { id: '13/photo.png', kind: 'file', badge: 'PNG', name: 'photo.png', detail: 'File Explorer' },
    ] }; },
    sendDirect: async ({ deviceId, itemId }) => { calls.push(['sendDirect', deviceId, itemId]); return failIds.includes(itemId) ? { ok: false, error: 'Could not read that window' } : { ok: true, what: 'tab' }; },
    readCurrent: async () => current || { ok: true, items: [{ kind: 'tab', url: 'https://x' }], label: 'Example' },
    sendItems: async (deviceId, items) => { calls.push(['sendItems', deviceId, items]); return { ok: true, sent: items.length, total: items.length, what: 'tab' }; },
  };
  const overlay = { send: (e) => events.push(e), onSendMenuAnswer: (cb) => { answerCb = cb; } };
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } };
  const sent = [];
  class BrowserWindow {
    constructor(opts) { this.opts = opts; this.webContents = { send: (ch) => sent.push(ch), session: { setPermissionRequestHandler: (f) => { this.req = f; }, setPermissionCheckHandler: (f) => { this.check = f; } } }; }
    loadFile(f) { this.file = f; }
    isDestroyed() { return false; }
  }
  const globalShortcut = { register: (k, fn) => { shortcuts[k] = fn; return true; }, unregister: (k) => { delete shortcuts[k]; } };
  const voice = createVoice({ manager, overlay, ipcMain, globalShortcut, BrowserWindow, appDir: path.join(__dirname, '..'), config: { elevenLabsAgentId: 'agent', wakeWordFile: 'nope.ppn' } });
  const tool = (name, params) => handlers['voice:tool']({}, name, params);
  const menus = () => events.filter((e) => e.type === 'SEND_MENU');
  const toasts = () => events.filter((e) => e.type === 'VOICE_TOAST').map((e) => e.text);
  const answer = (id, a) => answerCb(id, a);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { voice, tool, events, calls, menus, toasts, answer, flush, handlers, listeners, shortcuts, sent };
}

test('name matching: exact, prefix, contains, none, several, focus', async () => {
  const s = setup({ people: [['Rafi Khan', 'collaborative'], ['Rafa', 'collaborative'], ['Bob', 'focus'], ['Ann', 'collaborative']] });
  assert.deepEqual(await s.tool('send_current', { targetName: 'rafa' }), { ok: true, sentTo: 'Rafa', label: 'Example', sent: 1, total: 1 });
  assert.equal((await s.tool('send_current', { targetName: 'raf' })).error, 'Two people match: Rafi Khan and Rafa');
  assert.equal((await s.tool('send_current', { targetName: 'khan' })).sentTo, 'Rafi Khan');
  assert.equal((await s.tool('send_current', { targetName: 'Zed' })).error, 'No one called Zed is in the room');
  assert.equal((await s.tool('send_current', { targetName: 'BOB' })).error, 'Bob is in Focus mode');
  assert.equal((await s.tool('send_current', { targetName: 'me' })).error, 'No one called me is in the room'); // not ourselves
});

test('not in a room: every tool says join first, and so does the hotkey', async () => {
  const s = setup({ inRoom: false });
  for (const t of ['list_members', 'set_mode', 'send_current', 'show_send_menu', 'send_items']) {
    assert.deepEqual(await s.tool(t, {}), { ok: false, error: 'Join a room first' });
  }
  s.shortcuts['Control+Alt+Space']();
  assert.deepEqual(s.toasts(), ['Join a room first']);
  assert.deepEqual(s.sent, []);
});

test('hotkey in a room starts the voice window; stop unregisters it', () => {
  const s = setup();
  s.shortcuts['Control+Alt+Space']();
  assert.deepEqual(s.sent, ['voice:start']);
  s.voice.stop();
  assert.equal(s.shortcuts['Control+Alt+Space'], undefined);
});

test('voice window: hidden, own preload, microphone only', async () => {
  const s = setup();
  const w = s.voice.window();
  assert.equal(w.opts.show, false); assert.equal(w.opts.skipTaskbar, true);
  assert.match(w.opts.webPreferences.preload, /preload-voice\.js$/); assert.match(w.file, /voice[/\\]index\.html$/);
  const asked = []; w.req(null, 'media', (ok) => asked.push(ok)); w.req(null, 'geolocation', (ok) => asked.push(ok));
  assert.deepEqual(asked, [true, false]);
  assert.equal(w.check(null, 'media'), true); assert.equal(w.check(null, 'notifications'), false);
  const cfg = await s.handlers['voice:getConfig']();
  assert.deepEqual(cfg, { agentId: 'agent', accessKey: '', keywordPath: '', modelPath: '' });
});

test('voice state and notices go to the overlay', () => {
  const s = setup();
  s.listeners['voice:state']({}, 'listening'); s.listeners['voice:state']({}, 'bogus');
  s.listeners['voice:notice']({}, 'No microphone');
  assert.deepEqual(s.events, [{ type: 'VOICE', state: 'listening' }, { type: 'VOICE_TOAST', text: 'No microphone' }]);
});

test('list_members and set_mode', async () => {
  const s = setup({ people: [['Rafi', 'focus']] });
  assert.deepEqual(await s.tool('list_members'), { ok: true, members: [{ name: 'Me', mode: 'collaborative', isMe: true }, { name: 'Rafi', mode: 'focus', isMe: false }] });
  assert.deepEqual(await s.tool('set_mode', { mode: 'Focus' }), { ok: true, mode: 'focus' });
  assert.equal((await s.tool('set_mode', { mode: 'party' })).ok, false);
  assert.deepEqual(s.calls, [['setMode', 'focus']]);
});

test('send_current with no name and one other member sends to them', async () => {
  const s = setup({ people: [['Rafi', 'collaborative']] });
  const r = await s.tool('send_current', {});
  assert.equal(r.ok, true); assert.equal(r.sentTo, 'Rafi');
  assert.equal(s.calls[0][1], 'd0');
});

test('send_current with no name and two people: picker, then the click sends', async () => {
  const s = setup();
  const r = await s.tool('send_current', {});
  assert.deepEqual(r, { ok: false, needTarget: true, people: ['Rafi', 'Charlie'], label: 'Example' });
  const m = s.menus()[0];
  assert.equal(m.items, null); assert.equal(m.title, 'Send Example to…'); assert.equal(m.targetDeviceId, null);
  assert.deepEqual(m.people.map((p) => p.name), ['Rafi', 'Charlie']);
  s.answer('stale', { itemIds: null, deviceId: 'd0' }); await s.flush();
  assert.equal(s.calls.length, 0);
  s.answer(m.requestId, { itemIds: null, deviceId: 'd1' }); await s.flush();
  assert.equal(s.calls[0][0], 'sendItems'); assert.equal(s.calls[0][1], 'd1');
  assert.deepEqual(s.toasts(), ['Sent Example to Charlie']);
});

test('send_current with nothing in front shows the menu instead', async () => {
  const s = setup({ current: { ok: false, error: 'Open a browser tab, document or File Explorer window first' } });
  const r = await s.tool('send_current', { targetName: 'Rafi' });
  assert.equal(r.menuShown, true); assert.equal(r.ok, false); assert.match(r.error, /Open a browser tab/);
  assert.deepEqual(r.items.map((i) => i.number), [1, 2, 3]);
  assert.equal(s.menus()[0].targetDeviceId, 'd0');
});

test('show_send_menu then clicking items + a person sends them one by one', async () => {
  const s = setup();
  const r = await s.tool('show_send_menu', {});
  assert.deepEqual(r.items, [{ number: 1, name: 'Example', detail: 'Chrome' }, { number: 2, name: 'notes.txt', detail: 'Notepad' }, { number: 3, name: 'photo.png', detail: 'File Explorer' }]);
  const m = s.menus()[0];
  assert.equal(m.items.length, 3); assert.equal(m.items[2].id, '13/photo.png'); assert.equal(m.people.length, 2);
  s.answer(m.requestId, { itemIds: ['11', '13/photo.png'], deviceId: 'd0' });
  await s.flush(); await s.flush();
  assert.deepEqual(s.calls.filter((c) => c[0] === 'sendDirect'), [['sendDirect', 'd0', '11'], ['sendDirect', 'd0', '13/photo.png']]);
  assert.deepEqual(s.toasts(), ['Sent 2 items to Rafi']);
});

test('show_send_menu: cancel sends nothing; partial failure is reported', async () => {
  const s = setup({ failIds: ['12'] });
  await s.tool('show_send_menu', { targetName: 'charlie' });
  let m = s.menus()[0];
  assert.equal(m.people, null); assert.equal(m.targetDeviceId, 'd1');
  s.answer(m.requestId, null); await s.flush();
  assert.equal(s.calls.filter((c) => c[0] === 'sendDirect').length, 0);
  await s.tool('show_send_menu', { targetName: 'charlie' });
  m = s.menus()[1];
  s.answer(m.requestId, { itemIds: ['11', '12'], deviceId: null }); await s.flush(); await s.flush();
  assert.deepEqual(s.toasts(), ['Sent 1 of 2 to Charlie. Could not read that window']);
});

test('show_send_menu with everyone in Focus says so', async () => {
  const s = setup({ people: [['Rafi', 'focus']] });
  assert.deepEqual(await s.tool('show_send_menu', {}), { ok: false, error: 'Rafi is in Focus mode' });
});

test('send_items by numbers closes the menu and sends', async () => {
  const s = setup();
  assert.deepEqual(await s.tool('send_items', { numbers: [1] }), { ok: false, error: 'Show the send menu first' });
  await s.tool('show_send_menu', {});
  const m = s.menus()[0];
  assert.deepEqual(await s.tool('send_items', { numbers: [2, 3] }), { ok: false, needTarget: true, people: ['Rafi', 'Charlie'] });
  assert.deepEqual(await s.tool('send_items', { numbers: [9], targetName: 'Rafi' }), { ok: false, error: 'There is no item 9' });
  const r = await s.tool('send_items', { numbers: [2, 3], targetName: 'Rafi' });
  assert.deepEqual(r, { ok: true, sent: 2, total: 2, sentTo: 'Rafi' });
  assert.deepEqual(s.events.find((e) => e.type === 'SEND_MENU_CLOSE'), { type: 'SEND_MENU_CLOSE', requestId: m.requestId });
  assert.deepEqual(s.calls.filter((c) => c[0] === 'sendDirect').map((c) => c[2]), ['12', '13/photo.png']);
});

test('send_items to someone in Focus is refused', async () => {
  const s = setup({ people: [['Rafi', 'collaborative'], ['Bob', 'focus']] });
  await s.tool('show_send_menu', {});
  assert.deepEqual(await s.tool('send_items', { numbers: [1], targetName: 'bob' }), { ok: false, error: 'Bob is in Focus mode' });
});

test('a newer menu replaces the old one; the old answer is ignored', async () => {
  const s = setup();
  await s.tool('show_send_menu', {});
  await s.tool('show_send_menu', {});
  const [a, b] = s.menus();
  s.answer(a.requestId, { itemIds: ['11'], deviceId: 'd0' }); await s.flush();
  assert.equal(s.calls.filter((c) => c[0] === 'sendDirect').length, 0);
  s.answer(b.requestId, { itemIds: ['11'], deviceId: 'd0' }); await s.flush(); await s.flush();
  assert.equal(s.calls.filter((c) => c[0] === 'sendDirect').length, 1);
});

test('summary sentences', () => {
  assert.equal(summary(1, 1, 'Rafi', 'report.docx'), 'Sent report.docx to Rafi');
  assert.equal(summary(0, 1, 'Rafi', 'x', 'Rafi is in Focus mode'), 'Rafi is in Focus mode');
});
