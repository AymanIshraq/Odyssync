// "Hey Odyssync": the hidden Voice window, the Ctrl+Alt+Space hotkey and the five
// tools the voice agent can call. Every send goes through the room manager, the
// same code as right-click send. Menus and toasts are drawn by the overlay.
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOTKEY = 'Control+Alt+Space';
const MODES = ['collaborative', 'approval', 'focus'];
const STATES = ['idle', 'listening', 'thinking', 'speaking'];

// "A", "A and B", "A, B and C"
const andList = (names) => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
const countWord = (n) => (n === 2 ? 'Two' : n === 3 ? 'Three' : String(n));

// The result sentence after a send, like the Control Center's ("Sent 2 items to Rafi").
function summary(sent, total, name, label, error) {
  if (total && sent === total) return total === 1 ? `Sent ${label || 'it'} to ${name}` : `Sent ${total} items to ${name}`;
  if (sent) return `Sent ${sent} of ${total} to ${name}. ${error || ''}`.trim();
  return error || 'Could not send.';
}

// Where people drop their own trained wake words (*.onnx); the helper looks here too.
function defaultWakeFolder() {
  return process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'Odyssync', 'wakewords')
    : path.join(os.homedir(), '.odyssync', 'wakewords');
}

function createVoice({
  manager, overlay, ipcMain, globalShortcut, BrowserWindow, appDir, config = {}, notify = () => {},
  bridge = { send: () => false, onMessage: () => {} }, settingsPath = '', shell = null,
  wakeFolder = defaultWakeFolder(), getControlWindow = () => null,
}) {
  const toast = (text) => overlay.send({ type: 'VOICE_TOAST', text });
  let win = null;
  let nextId = 0;
  let pending = null; // the one menu/picker on the overlay we wait for: { requestId, answer(answer) }
  let menu = null; // the last numbered "Select to send" list: { items: [{ number, id, name, detail }], target }

  // ---------- who is in the room ----------

  const inRoom = () => !!manager.getState().roomNumber;
  function others() {
    const s = manager.getState();
    return s.members.filter((m) => m.deviceId !== s.self.deviceId).map((m) => ({
      deviceId: m.deviceId, name: (m.profile && m.profile.displayName) || 'Someone', mode: s.modes[m.deviceId] || 'collaborative',
    }));
  }
  const focusError = (p) => `${p.name} is in Focus mode`;

  // Find one other member by a spoken name: exact, then start of name, then anywhere in it.
  // Returns { person } or { error }.
  function findPerson(name) {
    const said = String(name).trim().toLowerCase();
    const list = others();
    const lower = (p) => p.name.toLowerCase();
    let hits = list.filter((p) => lower(p) === said);
    if (!hits.length) hits = list.filter((p) => lower(p).startsWith(said));
    if (!hits.length) hits = list.filter((p) => lower(p).includes(said));
    if (!said || !hits.length) return { error: `No one called ${String(name).trim() || 'that'} is in the room` };
    if (hits.length > 1) return { error: `${countWord(hits.length)} people match: ${andList(hits.map((p) => p.name))}` };
    if (hits[0].mode === 'focus') return { error: focusError(hits[0]) };
    return { person: hits[0] };
  }
  const hasName = (n) => typeof n === 'string' && n.trim() !== '';

  // ---------- the overlay's menu ----------

  // Show a menu or picker; a newer one replaces the old (the old one's answer is ignored).
  function showMenu(event, onAnswer) {
    const requestId = 'voice-' + (++nextId);
    pending = { requestId, onAnswer };
    overlay.send({ type: 'SEND_MENU', requestId, ...event });
    return requestId;
  }
  function closeMenu() {
    if (!pending) return;
    overlay.send({ type: 'SEND_MENU_CLOSE', requestId: pending.requestId });
    pending = null;
  }
  overlay.onSendMenuAnswer((requestId, answer) => {
    if (!pending || pending.requestId !== requestId) return; // stale or replaced
    const p = pending;
    pending = null;
    if (answer) p.onAnswer(answer);
  });

  // Send menu items (by their ids) one after another. Resolves { sent, total, error, label }.
  async function sendIds(deviceId, items) {
    let sent = 0, error;
    for (const item of items) {
      const r = await manager.sendDirect({ deviceId, itemId: item.id });
      if (r.ok) sent++; else if (!error) error = r.error;
    }
    return { sent, total: items.length, error, label: items.length === 1 ? items[0].name : '' };
  }

  // The numbered "Select to send" menu, for one member (target) or anyone.
  async function showSendMenu(target) {
    let guard = target;
    if (!guard) {
      const list = others();
      if (!list.length) return { ok: false, error: 'No one else is in the room' };
      guard = list.find((p) => p.mode !== 'focus');
      if (!guard) return { ok: false, error: focusError(list[0]) };
    }
    const r = await manager.listSendable(guard.deviceId);
    if (!r.ok) return { ok: false, error: r.error };
    const items = r.items.map((it, i) => ({ ...it, number: i + 1 }));
    menu = { items, target };
    showMenu({
      title: target ? `Send to ${target.name}` : 'Select to send',
      items: items.map(({ id, number, kind, badge, name, detail }) => ({ id, number, kind, badge, name, detail })),
      people: target ? null : others().map(({ deviceId, name, mode }) => ({ deviceId, name, mode })),
      targetDeviceId: target ? target.deviceId : null,
    }, async (answer) => {
      const ids = Array.isArray(answer.itemIds) ? answer.itemIds : [];
      const deviceId = answer.deviceId || (target && target.deviceId);
      const picked = items.filter((it) => ids.includes(it.id));
      if (!deviceId || !picked.length) return;
      const res = await sendIds(deviceId, picked);
      toast(summary(res.sent, res.total, nameOf(deviceId), res.label, res.error));
    });
    return { ok: true, items: items.map(({ number, name, detail }) => ({ number, name, detail })) };
  }
  const nameOf = (deviceId) => (others().find((p) => p.deviceId === deviceId) || { name: 'them' }).name;

  // ---------- the tools ----------

  const tools = {
    list_members() {
      const s = manager.getState();
      return {
        ok: true,
        members: s.members.map((m) => ({
          name: (m.profile && m.profile.displayName) || 'Someone', mode: s.modes[m.deviceId] || 'collaborative', isMe: m.deviceId === s.self.deviceId,
        })),
      };
    },

    set_mode({ mode } = {}) {
      const m = String(mode || '').trim().toLowerCase();
      if (!MODES.includes(m)) return { ok: false, error: 'The mode must be collaborative, approval or focus' };
      manager.setMode(m);
      return { ok: true, mode: m };
    },

    async send_current({ targetName } = {}) {
      let target = null;
      if (hasName(targetName)) {
        const f = findPerson(targetName);
        if (f.error) return { ok: false, error: f.error };
        target = f.person;
      } else {
        const list = others();
        if (!list.length) return { ok: false, error: 'No one else is in the room' };
        if (list.length === 1) {
          if (list[0].mode === 'focus') return { ok: false, error: focusError(list[0]) };
          target = list[0];
        }
      }
      const cur = await manager.readCurrent();
      if (!cur.ok) {
        // Nothing sendable in front: show the menu so the user can pick.
        const m = await showSendMenu(target);
        if (!m.ok) return { ok: false, error: m.error };
        return { ok: false, menuShown: true, items: m.items, error: cur.error };
      }
      if (!target) {
        // Two or more people and no name: the people picker.
        const people = others();
        const kept = cur.items;
        showMenu({
          title: `Send ${cur.label} to…`, items: null, targetDeviceId: null,
          people: people.map(({ deviceId, name, mode }) => ({ deviceId, name, mode })),
        }, async (answer) => {
          if (!answer.deviceId) return;
          const r = await manager.sendItems(answer.deviceId, kept);
          toast(summary(r.sent, r.total, nameOf(answer.deviceId), cur.label, r.error));
        });
        return { ok: false, needTarget: true, people: people.map((p) => p.name), label: cur.label };
      }
      const r = await manager.sendItems(target.deviceId, cur.items);
      if (!r.sent) return { ok: false, error: r.error || 'Could not send' };
      return { ok: r.ok, sentTo: target.name, label: cur.label, sent: r.sent, total: r.total, ...(r.ok ? {} : { error: r.error }) };
    },

    async show_send_menu({ targetName } = {}) {
      let target = null;
      if (hasName(targetName)) {
        const f = findPerson(targetName);
        if (f.error) return { ok: false, error: f.error };
        target = f.person;
      }
      return showSendMenu(target);
    },

    async send_items({ numbers, targetName } = {}) {
      if (!menu) return { ok: false, error: 'Show the send menu first' };
      const said = (Array.isArray(numbers) ? numbers : [numbers]).filter((n) => n !== undefined && n !== null && n !== '');
      if (!said.length) return { ok: false, error: 'Say which items to send' };
      const picked = [];
      for (const n of said) {
        const item = menu.items.find((it) => it.number === Number(n));
        if (!item) return { ok: false, error: `There is no item ${n}` };
        if (!picked.includes(item)) picked.push(item);
      }
      let target = null;
      if (hasName(targetName)) {
        const f = findPerson(targetName);
        if (f.error) return { ok: false, error: f.error };
        target = f.person;
      } else if (menu.target) {
        target = others().find((p) => p.deviceId === menu.target.deviceId);
        if (!target) return { ok: false, error: `${menu.target.name} is not in the room any more` };
        if (target.mode === 'focus') return { ok: false, error: focusError(target) };
      } else {
        const list = others();
        if (!list.length) return { ok: false, error: 'No one else is in the room' };
        if (list.length > 1) return { ok: false, needTarget: true, people: list.map((p) => p.name) };
        if (list[0].mode === 'focus') return { ok: false, error: focusError(list[0]) };
        target = list[0];
      }
      closeMenu();
      const r = await sendIds(target.deviceId, picked);
      return { ok: r.sent === r.total, sent: r.sent, total: r.total, sentTo: target.name, ...(r.error ? { error: r.error } : {}) };
    },
  };

  async function runTool(name, params) {
    if (!Object.hasOwn(tools, name)) return { ok: false, error: 'I cannot do that' };
    if (!inRoom()) return { ok: false, error: 'Join a room first' };
    try {
      return await tools[name](params && typeof params === 'object' ? params : {});
    } catch (err) {
      console.log('[voice] ' + name + ' failed: ' + err.message);
      return { ok: false, error: 'Something went wrong' };
    }
  }

  // ---------- IPC from the Voice window ----------

  ipcMain.handle('voice:getConfig', () => ({ agentId: config.elevenLabsAgentId || '' }));
  ipcMain.handle('voice:tool', (_e, name, params) => runTool(name, params));
  ipcMain.on('voice:state', (_e, state) => {
    if (!STATES.includes(state)) return;
    overlay.send({ type: 'VOICE', state });
    const busy = state !== 'idle';
    if (busy !== inSession) { inSession = busy; pushWake(); } // off during a session, back on after
  });
  ipcMain.on('voice:notice', (_e, text) => { if (typeof text === 'string' && text) toast(text); });

  // ---------- the wake word (listened for by the Windows helper) ----------

  let saved = loadSettings(); // { enabled, model } as the user chose it
  let models = []; // [{ id, name, source }] from the helper's last WAKE_WORDS
  let status = null; // the helper's last WAKE_WORD_STATUS: { enabled, model?, error? }
  let inSession = false; // true while the voice is listening, thinking or speaking
  let lastSent = null; // the SET_WAKE_WORD this helper connection last got, as text

  function loadSettings() {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return { enabled: s.enabled !== false, model: typeof s.model === 'string' ? s.model : null };
    } catch {
      return { enabled: true, model: null };
    }
  }
  function saveSettings() {
    if (!settingsPath) return;
    try {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(saved));
    } catch (err) { console.log('[voice] could not save wake settings: ' + err.message); }
  }
  const has = (id) => models.some((m) => m.id === id);
  // The saved choice if the helper has it, else Hey Odyssync, else Hey Jarvis, else the first.
  function currentModel() {
    if (!models.length) return saved.model;
    for (const id of [saved.model, 'hey_odyssync', 'hey_jarvis']) if (id && has(id)) return id;
    return models[0].id;
  }
  const wakeSettings = () => ({ enabled: saved.enabled, model: currentModel(), models, status });
  function tellControl() {
    const w = getControlWindow();
    if (w && !w.isDestroyed()) w.webContents.send('voice:wakeSettings', wakeSettings());
  }
  // Tell the helper what to listen for, unless it already knows.
  function pushWake() {
    const model = currentModel();
    if (!model) return; // wait for the helper's list
    const msg = { type: 'SET_WAKE_WORD', enabled: saved.enabled && !inSession, model };
    const text = JSON.stringify(msg);
    if (text !== lastSent && bridge.send(msg)) lastSent = text;
  }
  const listWake = () => bridge.send({ type: 'LIST_WAKE_WORDS' });

  bridge.onMessage((msg) => {
    switch (msg.type) {
      case 'SIDECAR_READY': // a (re)connected helper knows nothing yet
        lastSent = null;
        listWake();
        pushWake();
        return;
      case 'WAKE_WORDS':
        models = Array.isArray(msg.models) ? msg.models.filter((m) => m && typeof m.id === 'string') : [];
        pushWake();
        tellControl();
        return;
      case 'WAKE_WORD_STATUS':
        status = { enabled: !!msg.enabled, ...(msg.model ? { model: msg.model } : {}), ...(msg.error ? { error: msg.error } : {}) };
        tellControl();
        return;
      case 'WAKE_WORD': // same as the hotkey, but quiet when it cannot start
        if (inRoom() && !inSession && win && !win.isDestroyed()) win.webContents.send('voice:start');
        return;
      default:
    }
  });

  ipcMain.handle('voice:getWakeSettings', () => {
    listWake(); // a newly dropped file shows up via the WAKE_WORDS answer
    return wakeSettings();
  });
  ipcMain.handle('voice:setWakeSettings', (_e, next = {}) => {
    const n = next && typeof next === 'object' ? next : {};
    if (n.model !== undefined && n.model !== null && !has(n.model)) return { ...wakeSettings(), error: 'That wake word is not available' };
    saved = { enabled: n.enabled === undefined ? saved.enabled : !!n.enabled, model: n.model || currentModel() };
    saveSettings();
    pushWake();
    tellControl();
    return wakeSettings();
  });
  ipcMain.handle('voice:openWakeFolder', async () => {
    try {
      fs.mkdirSync(wakeFolder, { recursive: true });
      const err = shell ? await shell.openPath(wakeFolder) : '';
      listWake();
      return err ? { ok: false, error: err, folder: wakeFolder } : { ok: true, folder: wakeFolder };
    } catch (err) {
      return { ok: false, error: err.message, folder: wakeFolder };
    }
  });

  // ---------- the hidden window and the hotkey ----------

  win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    // Its own session, so the microphone permission below touches no other window.
    webPreferences: { preload: path.join(appDir, 'main', 'preload-voice.js'), backgroundThrottling: false, partition: 'persist:voice' },
  });
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  win.loadFile(path.join(appDir, 'voice', 'index.html'));

  function onHotkey() {
    if (!inRoom()) { toast('Join a room first'); return; }
    if (win && !win.isDestroyed()) win.webContents.send('voice:start');
  }
  if (!globalShortcut.register(HOTKEY, onHotkey)) notify('Ctrl+Alt+Space is used by another app');

  return {
    window: () => win,
    runTool,
    hotkey: onHotkey,
    wakeSettings,
    stop: () => globalShortcut.unregister(HOTKEY),
  };
}

module.exports = { createVoice, summary };
