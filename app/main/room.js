// Room: create, join and leave a room; keep the member list; on the host, own
// the layout (each laptop's screen as a rectangle) and work out who touches
// whom on each edge. Pushes one state object to the Control Center.
// No Electron in here, so it can be tested with plain `node`.
const os = require('os');
const crypto = require('crypto');
const { createTransport } = require('./transport');
const { createHandoff } = require('./handoff');
const { start } = require('../server/server');

const PATHS = ['cloud', 'local'];

// A random string of n digits, leading zeros allowed ("004213").
// Called through `crypto.` so a test can swap the random function.
const digits = (n) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');

// This machine's own network addresses (IPv4, not the 127.0.0.1 loopback).
function getLocalIps() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

// Neighbours from screen rectangles. B is A's right neighbour when A's right
// side is exactly B's left side and their heights overlap by more than 0;
// same idea for the other edges. Several on one edge: larger overlap wins.
function computeNeighbors(screens) {
  const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1);
  const result = {};
  for (const a of screens) {
    const best = { left: 0, right: 0, top: 0, bottom: 0 };
    const n = { left: null, right: null, top: null, bottom: null };
    const consider = (edge, touches, amount, id) => {
      if (touches && amount > best[edge]) { best[edge] = amount; n[edge] = id; }
    };
    for (const b of screens) {
      if (b.deviceId === a.deviceId) continue;
      const vertical = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
      const horizontal = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
      consider('right', a.x + a.w === b.x, vertical, b.deviceId);
      consider('left', b.x + b.w === a.x, vertical, b.deviceId);
      consider('bottom', a.y + a.h === b.y, horizontal, b.deviceId);
      consider('top', b.y + b.h === a.y, horizontal, b.deviceId);
    }
    result[a.deviceId] = n;
  }
  return result;
}

// Which of THIS laptop's edges have a neighbour, from a getState() object.
// A neighbour counts only while it is still in the member list.
function activeEdges(state) {
  const mine = (state.neighbors || {})[state.self.deviceId] || {};
  const ids = (state.members || []).map((m) => m.deviceId);
  const has = (edge) => !!mine[edge] && ids.includes(mine[edge]);
  return { left: has('left'), right: has('right'), top: has('top'), bottom: has('bottom') };
}

function createRoomManager({ relayUrl, localPort, profile: startProfile, bridge, overlay }) {
  const deviceId = crypto.randomBytes(4).toString('hex');
  const profile = { ...startProfile };
  const transport = createTransport(deviceId); // one for the whole life, so mids never restart
  let myMode = 'collaborative'; // survives leaving and joining rooms
  let room = null; // null = not in a room
  let server = null; // our embedded room server (host only)
  let stopping = Promise.resolve(); // finishes when the last embedded server is fully closed
  let pendingJoin = null; // { roomNumber, pin } while we wait for JOIN_ACCEPTED
  let pendingCreate = null; // host metadata until the first server confirms creation
  let waiting = null; // one server answer we are waiting for
  const stateListeners = [];
  const noticeListeners = [];
  const handoff = createHandoff({ transport, getState, bridge, overlay }); // the tab handoff (handoff.js)
  stateListeners.push(() => handoff.roomChanged()); // after every room change: did someone leave?

  // ---------- state out ----------

  // "local" when we talk to that laptop over our local socket, else "relay".
  const pathOf = (id) => (transport.isOpen('local') && (id === deviceId || transport.localPeers().includes(id)) ? 'local' : 'relay');
  const allModes = () => ({ ...room.modes, [deviceId]: myMode });

  function getState() {
    const ids = room ? [deviceId, ...Object.keys(room.members)] : [];
    // Through JSON and back, so the caller always gets a fresh plain copy.
    return JSON.parse(JSON.stringify({
      self: { deviceId, profile },
      isHost: !!room && room.isHost,
      roomNumber: room ? room.roomNumber : null,
      pin: room ? room.pin : null,
      localIps: room ? room.localIps : [],
      members: ids.map((id) => ({ deviceId: id, profile: id === deviceId ? profile : room.members[id].profile })),
      screens: room ? room.screens : [],
      neighbors: room ? room.neighbors : {},
      modes: room ? allModes() : {},
      transports: Object.fromEntries(ids.map((id) => [id, pathOf(id)])),
      pings: {},
    }));
  }

  const emit = () => stateListeners.forEach((cb) => cb(getState()));
  const notify = (kind, text) => noticeListeners.forEach((cb) => cb({ kind, text }));

  // ---------- small helpers ----------

  // Wait for one of `types` from the server on `path`; resolves the message, or null on timeout.
  function waitFor(path, types, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiting = null; resolve(null); }, ms);
      waiting = { path, types, done: (msg) => { clearTimeout(timer); waiting = null; resolve(msg); } };
    });
  }

  function makeRoom(fields) {
    return { members: {}, screens: [], neighbors: {}, modes: {}, ...fields };
  }

  // Host only: recompute neighbours and tell everyone.
  function broadcastLayout() {
    room.neighbors = computeNeighbors(room.screens);
    transport.sendToPeer('*', { type: 'LAYOUT_UPDATED', screens: room.screens, neighbors: room.neighbors });
  }

  // A member was announced on one path. New to us: add them (and, on the host, place their screen).
  function addPath(id, memberProfile, path) {
    if (id === deviceId) return;
    if (room.members[id]) { room.members[id].paths.add(path); return; }
    room.members[id] = { profile: memberProfile, paths: new Set([path]) };
    room.modes[id] = 'collaborative'; // until their own MODE_UPDATED arrives
    if (!room.isHost) return;
    // To the right of the rightmost screen, top-aligned with it.
    const right = room.screens.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a), { x: 0, y: 0, w: 0 });
    room.screens.push({ deviceId: id, x: right.x + right.w, y: right.y, w: memberProfile.screenWidth, h: memberProfile.screenHeight });
    broadcastLayout();
    transport.sendToPeer(id, { type: 'ROOM_STATE', screens: room.screens, neighbors: room.neighbors, modes: allModes() });
  }

  // A member left one path. Gone from every path: remove them.
  function dropPath(id, path) {
    const member = room.members[id];
    if (!member) return;
    member.paths.delete(path);
    if (member.paths.size > 0) return;
    delete room.members[id];
    delete room.modes[id];
    if (!room.isHost) return;
    room.screens = room.screens.filter((s) => s.deviceId !== id);
    broadcastLayout();
  }

  // Close our embedded server, after it has had a moment to tell its clients the room is closed.
  function stopServer() {
    const s = server;
    server = null;
    if (!s) return stopping;
    const startedAt = Date.now();
    stopping = new Promise((resolve) => {
      const check = () => {
        if (s.clients.size === 0 || Date.now() - startedAt > 500) s.close(() => resolve());
        else setTimeout(check, 20);
      };
      check();
    });
    return stopping;
  }

  // The room is over for this laptop: back to "no room" with a notice.
  function endRoom(kind, text) {
    leaveRoom();
    notify(kind, text);
  }

  // ---------- incoming messages ----------

  transport.onMessage((msg, payload, path) => {
    // A member can join immediately after ROOM_CREATED, before createRoom's
    // local-server setup finishes. Establish host state before the next frame.
    if (msg.type === 'ROOM_CREATED' && !room && pendingCreate) {
      room = makeRoom({ isHost: true, hostId: deviceId, ...pendingCreate });
      room.screens = [{ deviceId, x: 0, y: 0, w: profile.screenWidth, h: profile.screenHeight }];
      room.neighbors = computeNeighbors(room.screens);
    }
    // First JOIN_ACCEPTED: set up the room right here, before the host's next message arrives.
    if (msg.type === 'JOIN_ACCEPTED' && !room && pendingJoin) {
      room = makeRoom({ isHost: false, hostId: msg.hostId, ...pendingJoin, localIps: msg.hostLocalIps || [] });
    }
    if (waiting && waiting.path === path && waiting.types.includes(msg.type)) waiting.done(msg);
    if (!room) return;

    switch (msg.type) {
      case 'JOIN_ACCEPTED':
        (msg.members || []).forEach((m) => addPath(m.deviceId, m.profile, path));
        break;
      case 'MEMBER_JOINED':
        addPath(msg.member.deviceId, msg.member.profile, path);
        break;
      case 'MEMBER_LEFT':
        if (msg.deviceId === deviceId) {
          if (msg.reason === 'kicked') return endRoom('kicked', 'The host removed you from the room');
          return;
        }
        dropPath(msg.deviceId, path);
        break;
      case 'ROOM_CLOSED':
        if (path === 'cloud' && transport.isOpen('local')) return; // the host is still here locally
        return endRoom('room_closed', 'The host closed the room');
      case 'LOCAL_PEERS':
        break; // transport already stored them; we only re-push state for the transport badges
      case 'LAYOUT_UPDATED':
      case 'ROOM_STATE':
        if (room.isHost || msg.fromId !== room.hostId) return; // only the host owns the layout
        room.screens = msg.screens || [];
        room.neighbors = msg.neighbors || {};
        if (msg.modes) room.modes = { ...room.modes, ...msg.modes }; // our own mode is kept apart, never overwritten
        break;
      case 'MODE_UPDATED':
        if (msg.deviceId !== msg.fromId || !room.members[msg.deviceId]) return;
        room.modes[msg.deviceId] = msg.mode;
        break;
      default:
        return handoff.onPeerMessage(msg, payload); // not ours: maybe a handoff message
    }
    emit();
  });

  // One of our sockets closed without us asking.
  transport.onClose((path) => {
    if (waiting && waiting.path === path) waiting.done(null);
    if (!room) return;
    if (!PATHS.some(transport.isOpen)) return endRoom('room_closed', 'Connection lost');
    Object.keys(room.members).forEach((id) => dropPath(id, path)); // carry on over the other path
    emit();
  });

  // ---------- actions ----------

  async function createRoom(displayName) {
    leaveRoom();
    await stopping; // the old embedded server must free the port first
    if (displayName) profile.displayName = displayName;
    let roomNumber = digits(6);
    const pin = digits(4);
    const localIps = getLocalIps();
    pendingCreate = { roomNumber, pin, localIps };
    const createMsg = () => {
      pendingCreate.roomNumber = roomNumber; // also follow relay number-collision retries
      return { type: 'CREATE_ROOM', roomNumber, pin, hostLocalIps: localIps, localPort, profile };
    };

    // 1. Register with the relay; a number that is taken gets a new one (5 tries).
    let relayOk = false;
    if (await transport.connect('cloud', relayUrl, 3000)) {
      for (let i = 0; i < 5 && !relayOk; i++) {
        if (i > 0) roomNumber = digits(6);
        transport.sendToServer('cloud', createMsg());
        const answer = await waitFor('cloud', ['ROOM_CREATED', 'ROOM_ERROR'], 3000);
        if (!answer) break;
        relayOk = answer.type === 'ROOM_CREATED';
      }
    }
    if (!relayOk) transport.close('cloud');

    // 2. Start our own server and join it ourselves (direct-IP laptops reach us there).
    let localOk = false;
    server = start({ port: localPort, local: true });
    const listening = await new Promise((resolve) => {
      server.once('listening', () => resolve(true));
      server.once('error', () => resolve(false));
    });
    if (listening && await transport.connect('local', 'ws://127.0.0.1:' + localPort, 3000)) {
      transport.sendToServer('local', createMsg());
      const answer = await waitFor('local', ['ROOM_CREATED', 'ROOM_ERROR'], 3000);
      localOk = !!answer && answer.type === 'ROOM_CREATED';
    }
    if (!localOk) { transport.close('local'); stopServer(); }

    if (!relayOk && !localOk) {
      pendingCreate = null;
      transport.close('cloud');
      notify('error', 'Could not start a room: no internet and the local port is busy');
      throw new Error('could not start a room');
    }
    if (!relayOk) notify('error', 'No internet: others can join by IP and PIN only');
    if (!localOk) notify('error', 'Local server could not start: others can join over the internet only');

    // Keep members/layout received while the second server was starting.
    pendingCreate = null;
    emit();
    return { roomNumber, pin, localIps };
  }

  async function joinRoom({ roomNumber, pin, displayName, directIp } = {}) {
    leaveRoom();
    if (displayName) profile.displayName = displayName;
    // Direct IP: straight to the host's own server, no relay at all.
    const path = directIp ? 'local' : 'cloud';
    const url = directIp ? 'ws://' + directIp + ':' + localPort : relayUrl;
    if (!(await transport.connect(path, url, 3000))) return { ok: false, reason: 'unreachable' };

    pendingJoin = { roomNumber: roomNumber || '', pin }; // by IP the number may be left empty
    transport.sendToServer(path, { type: 'JOIN_ROOM', roomNumber, pin, profile });
    const answer = await waitFor(path, ['JOIN_ACCEPTED', 'JOIN_REJECTED'], 5000);
    pendingJoin = null;
    if (answer && answer.type === 'JOIN_ACCEPTED' && room) {
      transport.sendToPeer('*', { type: 'MODE_UPDATED', deviceId, mode: myMode });
      emit();
      return { ok: true };
    }
    leaveRoom();
    return { ok: false, reason: answer ? answer.reason : 'unreachable' };
  }

  // Close everything and go back to "no room". Resolves once our embedded server is closed.
  function leaveRoom() {
    pendingJoin = null;
    pendingCreate = null;
    PATHS.forEach(transport.close);
    const wasInRoom = !!room;
    room = null;
    const done = stopServer();
    if (wasInRoom) emit();
    return done;
  }

  function setLayout(screens) {
    if (!room || !room.isHost || !Array.isArray(screens)) return;
    room.screens = screens.map(({ deviceId: id, x, y, w, h }) => ({ deviceId: id, x, y, w, h }));
    broadcastLayout();
    emit();
  }

  function setMode(mode) {
    myMode = mode;
    if (room) transport.sendToPeer('*', { type: 'MODE_UPDATED', deviceId, mode });
    emit();
  }

  function kick(targetDeviceId) {
    if (!room || !room.isHost) return;
    PATHS.forEach((path) => transport.sendToServer(path, { type: 'KICK_MEMBER', targetDeviceId }));
  }

  function sendDirect(targetDeviceId) {
    console.log('[room] sendDirect to ' + targetDeviceId + ' (not built yet)');
  }

  return {
    createRoom, joinRoom, leaveRoom, setLayout, setMode, kick, sendDirect, getState,
    onState: (cb) => { stateListeners.push(cb); cb(getState()); },
    onNotice: (cb) => { noticeListeners.push(cb); },
  };
}

// Connect the manager to the Control Center window: one handler per action,
// and every state and notice pushed to the window (if it is still there).
function wireIpc(ipcMain, getControlWindow, manager) {
  const push = (channel) => (data) => {
    const win = getControlWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  manager.onState(push('room:state'));
  manager.onNotice(push('room:notice'));
  ipcMain.handle('room:getState', () => manager.getState());
  for (const name of ['createRoom', 'joinRoom', 'leaveRoom', 'setLayout', 'setMode', 'kick', 'sendDirect']) {
    ipcMain.handle('room:' + name, (event, arg) => manager[name](arg));
  }
}

// Connect the overlay window: returns the `overlay` object the handoff uses.
// Events go to the overlay page; its answers come back here.
function wireOverlay(ipcMain, getOverlayWindow) {
  const win = () => { const w = getOverlayWindow(); return w && !w.isDestroyed() ? w : null; };
  // The Approval card needs clicks; the rest of the overlay stays click-through.
  ipcMain.on('overlay:setInteractive', (_e, on) => { const w = win(); if (w) w.setIgnoreMouseEvents(!on, { forward: true }); });
  return {
    send: (event) => { const w = win(); if (w) w.webContents.send('overlay:event', event); },
    onAnswer: (cb) => ipcMain.on('overlay:answer', (_e, transferId, accepted) => cb(transferId, accepted)),
    onGhostSettled: (cb) => ipcMain.on('overlay:ghostSettled', (_e, transferId, rect) => cb(transferId, rect)),
  };
}

module.exports = { createRoomManager, wireIpc, wireOverlay, computeNeighbors, activeEdges };
