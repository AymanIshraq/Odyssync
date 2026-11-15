// Transport: the message carrier of one laptop (TransportManager in the docs).
// It holds up to two sockets, "cloud" (the relay) and "local" (the host's
// embedded server), stamps the envelope on everything we send, picks the right
// socket for each target and hands incoming messages on after dropping repeats.
// Plain Node with `ws` only, so it can be tested without Electron.
const WebSocket = require('ws');

const MAX_SEEN = 5000; // per sender; past this we forget and start again (keeps memory small)

function createTransport(deviceId) {
  const sockets = {}; // "cloud" / "local" -> ws socket (also while it is still connecting)
  const seen = {}; // fromId -> Set of mids we already handed on
  let nextMid = 1;
  let peers = []; // deviceIds from the last LOCAL_PEERS
  let messageCb = () => {};
  let closeCb = () => {};

  const isOpen = (name) => !!sockets[name] && sockets[name].readyState === WebSocket.OPEN;

  // Stop tracking this socket (only if it is still the one under that name).
  function forget(name, socket) {
    if (sockets[name] !== socket) return false;
    delete sockets[name];
    if (name === 'local') peers = [];
    return true;
  }

  // Open a socket; resolves true once open, false on error or timeout. Never rejects.
  function connect(name, url, timeoutMs = 5000) {
    close(name);
    return new Promise((resolve) => {
      const socket = new WebSocket(url);
      sockets[name] = socket;
      let opened = false;
      let settled = false;
      const timer = setTimeout(() => fail('timed out'), timeoutMs);

      function fail(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log('[transport] ' + name + ' connect to ' + url + ' failed: ' + reason);
        forget(name, socket); // forgotten first, so its close event does nothing
        socket.terminate();
        resolve(false);
      }

      socket.on('open', () => {
        if (settled) return;
        settled = opened = true;
        clearTimeout(timer);
        resolve(true);
      });
      socket.on('error', (err) => {
        if (!settled) return fail(err.message);
        if (opened) console.log('[transport] ' + name + ' socket error: ' + err.message);
      });
      socket.on('close', () => {
        // Still tracked here means we did not ask for this close.
        if (forget(name, socket) && opened) closeCb(name);
      });
      socket.on('message', (data, isBinary) => {
        if (sockets[name] === socket) receive(name, data, isBinary);
      });
    });
  }

  // Close a socket we asked to close: onClose is not called for it.
  function close(name) {
    const socket = sockets[name];
    if (!socket) return;
    forget(name, socket);
    socket.close();
  }

  // One incoming message: parse it, drop repeats, then hand it on.
  function receive(name, data, isBinary) {
    let msg;
    let payload = null;
    try {
      if (isBinary) {
        // [uint32 LE header length][JSON header][payload bytes]
        const headerLength = data.readUInt32LE(0);
        if (4 + headerLength > data.length) throw new Error('header longer than frame');
        msg = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
        payload = data.subarray(4 + headerLength);
      } else {
        msg = JSON.parse(data.toString());
      }
      if (!msg || typeof msg !== 'object') throw new Error('not an object');
    } catch (err) {
      return console.log('[transport] ignored bad message on ' + name + ': ' + err.message);
    }
    // Server messages have no mid and are never dropped.
    if (msg.mid !== undefined) {
      const set = seen[msg.fromId] || (seen[msg.fromId] = new Set());
      if (set.has(msg.mid)) return;
      if (set.size >= MAX_SEEN) set.clear();
      set.add(msg.mid);
    }
    if (name === 'local' && msg.type === 'LOCAL_PEERS') peers = Array.isArray(msg.deviceIds) ? msg.deviceIds : [];
    messageCb(msg, payload, name);
  }

  // The socket for one laptop: local if it is on the local server with us, else cloud.
  function pick(id) {
    if (isOpen('local') && peers.includes(id)) return sockets.local;
    if (isOpen('cloud')) return sockets.cloud;
    return null;
  }

  // "*" goes on every open socket (same mid, the receiver drops the repeat).
  function targets(id) {
    if (id === '*') return ['cloud', 'local'].filter(isOpen).map((name) => sockets[name]);
    const socket = pick(id);
    return socket ? [socket] : [];
  }

  // A copy of the caller's fields with our envelope on top.
  const stamp = (toId, fields) => ({ ...fields, fromId: deviceId, toId, mid: nextMid++ });

  function sendToServer(name, msg) {
    if (!isOpen(name)) return false;
    sockets[name].send(JSON.stringify(stamp('server', msg)));
    return true;
  }

  function sendToPeer(id, msg) {
    const list = targets(id);
    if (list.length === 0) return false;
    const text = JSON.stringify(stamp(id, msg));
    for (const socket of list) socket.send(text);
    return true;
  }

  function sendBinaryToPeer(id, header, buffer) {
    const list = targets(id);
    if (list.length === 0) return false;
    const headerBytes = Buffer.from(JSON.stringify(stamp(id, header)), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(headerBytes.length, 0);
    const frame = Buffer.concat([length, headerBytes, buffer]);
    for (const socket of list) socket.send(frame);
    return true;
  }

  return {
    connect,
    close,
    isOpen,
    sendToServer,
    sendToPeer,
    sendBinaryToPeer,
    bufferedAmount: (id) => (pick(id) ? pick(id).bufferedAmount : 0),
    onMessage: (cb) => { messageCb = cb; },
    onClose: (cb) => { closeCb = cb; },
    localPeers: () => peers,
  };
}

module.exports = { createTransport };
