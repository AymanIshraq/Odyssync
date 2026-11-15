// Room server: a simple router between laptops. It checks the PIN, keeps the
// member list, passes messages on by toId and announces joins and leaves.
// The same file runs in the cloud (`node app/server/server.js`) and inside
// the host laptop (`start({ port, local: true })` from the app).
const { WebSocketServer } = require('ws');

const MAX_MEMBERS = 8;
const HEARTBEAT_MS = 800; // worst case to spot a dead laptop is 3 beats, so 800 ms keeps it under 3 s

function start({ port, local }) {
  const rooms = {}; // roomNumber -> { pin, hostId, hostLocalIps, localPort, members }
  const server = new WebSocketServer({ port });
  console.log('[server] listening on port ' + port + (local ? ' (local)' : ' (cloud)'));

  server.on('error', (err) => console.log('[server] error: ' + err.message));

  // Send one JSON message that the server itself writes.
  function send(socket, toId, type, fields) {
    socket.send(JSON.stringify({ type, fromId: 'server', toId, ...fields }));
  }

  // Send a server message to every member of a room, except `skipId` if given.
  function tellRoom(room, type, fields, skipId) {
    for (const id in room.members) {
      if (id !== skipId) send(room.members[id].socket, id, type, fields);
    }
  }

  // Embedded server only: tell everyone who is on this server right now.
  function sendLocalPeers(room) {
    if (local) tellRoom(room, 'LOCAL_PEERS', { deviceIds: Object.keys(room.members) });
  }

  // The room this socket belongs to, or null if it is not (or no longer) a member.
  function roomOf(socket) {
    const room = socket.room;
    if (!room || !room.members[socket.deviceId] || room.members[socket.deviceId].socket !== socket) return null;
    return room;
  }

  // Pass a message on by toId: "*" means everyone else in the room.
  function forward(room, fromSocket, toId, data, isBinary) {
    for (const id in room.members) {
      if (id === fromSocket.deviceId) continue;
      if (toId === '*' || toId === id) room.members[id].socket.send(data, { binary: isBinary });
    }
  }

  function createRoom(socket, msg) {
    if (rooms[msg.roomNumber] || (local && Object.keys(rooms).length > 0)) {
      return send(socket, msg.fromId, 'ROOM_ERROR', { reason: 'taken' });
    }
    const room = { pin: msg.pin, hostId: msg.fromId, hostLocalIps: msg.hostLocalIps, localPort: msg.localPort, members: {}, number: msg.roomNumber };
    room.members[msg.fromId] = { socket, profile: msg.profile };
    rooms[msg.roomNumber] = room;
    socket.deviceId = msg.fromId;
    socket.room = room;
    console.log('[server] room ' + msg.roomNumber + ' created by ' + msg.fromId);
    send(socket, msg.fromId, 'ROOM_CREATED', {});
    sendLocalPeers(room);
  }

  function joinRoom(socket, msg) {
    const room = local ? Object.values(rooms)[0] : rooms[msg.roomNumber];
    const reject = (reason) => send(socket, msg.fromId, 'JOIN_REJECTED', { reason });
    if (!room) return reject('no_room');
    if (msg.pin !== room.pin) return reject('bad_pin');
    const old = room.members[msg.fromId];
    if (!old && Object.keys(room.members).length >= MAX_MEMBERS) return reject('full');

    room.members[msg.fromId] = { socket, profile: msg.profile };
    socket.deviceId = msg.fromId;
    socket.room = room;
    const members = Object.keys(room.members).map((id) => ({ deviceId: id, profile: room.members[id].profile }));
    send(socket, msg.fromId, 'JOIN_ACCEPTED', { hostId: room.hostId, members, hostLocalIps: room.hostLocalIps, localPort: room.localPort });
    sendLocalPeers(room); // before MEMBER_JOINED, so the others already know the newcomer is on this server
    if (old) {
      // Same laptop came back on a new socket: swap quietly, nobody else is told.
      old.socket.close();
      console.log('[server] ' + msg.fromId + ' rejoined room ' + room.number);
    } else {
      console.log('[server] ' + msg.fromId + ' joined room ' + room.number);
      tellRoom(room, 'MEMBER_JOINED', { member: { deviceId: msg.fromId, profile: msg.profile } }, msg.fromId);
    }
  }

  function kickMember(socket, room, msg) {
    const target = room.members[msg.targetDeviceId];
    if (socket.deviceId !== room.hostId || msg.targetDeviceId === room.hostId || !target) return;
    tellRoom(room, 'MEMBER_LEFT', { deviceId: msg.targetDeviceId, reason: 'kicked' });
    delete room.members[msg.targetDeviceId]; // removed first, so its close event does nothing
    target.socket.close();
    console.log('[server] ' + msg.targetDeviceId + ' left room ' + room.number + ' (kicked)');
    sendLocalPeers(room);
  }

  server.on('connection', (socket) => {
    socket.missedPings = 0;
    socket.on('pong', () => { socket.missedPings = 0; });
    socket.on('error', (err) => console.log('[server] socket error: ' + err.message));

    socket.on('message', (data, isBinary) => {
      let msg;
      try {
        if (isBinary) {
          // [uint32 LE header length][JSON header][payload]: we only need the header.
          const headerLength = data.readUInt32LE(0);
          if (4 + headerLength > data.length) throw new Error('header longer than frame');
          msg = JSON.parse(data.subarray(4, 4 + headerLength).toString('utf8'));
        } else {
          msg = JSON.parse(data.toString());
        }
        if (!msg || typeof msg !== 'object') throw new Error('not an object');
      } catch (err) {
        return console.log('[server] ignored bad message: ' + err.message);
      }

      const room = roomOf(socket);
      if (!isBinary && !room && msg.type === 'CREATE_ROOM') return createRoom(socket, msg);
      if (!isBinary && !room && msg.type === 'JOIN_ROOM') return joinRoom(socket, msg);
      if (!room) return; // not in a room yet: ignore everything else
      if (!isBinary && msg.type === 'PING') return send(socket, socket.deviceId, 'PONG', { t: msg.t });
      if (!isBinary && msg.type === 'KICK_MEMBER') return kickMember(socket, room, msg);
      if (msg.toId) forward(room, socket, msg.toId, data, isBinary);
    });

    socket.on('close', () => {
      const room = roomOf(socket);
      if (!room) return; // never joined, was kicked, or was replaced by a rejoin
      const id = socket.deviceId;
      delete room.members[id];
      if (id === room.hostId) {
        // Host gone: the room ends for everyone.
        tellRoom(room, 'ROOM_CLOSED', {});
        for (const otherId in room.members) room.members[otherId].socket.close();
        room.members = {};
        delete rooms[room.number];
        console.log('[server] room ' + room.number + ' closed (host ' + (socket.lost ? 'lost' : 'left') + ')');
        return;
      }
      const reason = socket.lost ? 'lost' : 'left';
      console.log('[server] ' + id + ' left room ' + room.number + ' (' + reason + ')');
      tellRoom(room, 'MEMBER_LEFT', { deviceId: id, reason });
      sendLocalPeers(room);
    });
  });

  // Heartbeat: a ws-level ping every beat; two unanswered in a row means the laptop is gone.
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      if (socket.missedPings >= 2) {
        socket.lost = true;
        socket.terminate();
        continue;
      }
      socket.missedPings++;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  // Closing the server also stops the heartbeat and drops anyone still connected.
  const closeServer = server.close.bind(server);
  server.close = (cb) => {
    clearInterval(timer);
    for (const socket of server.clients) socket.terminate();
    return closeServer(cb);
  };

  return server;
}

module.exports = { start };

if (require.main === module) start({ port: process.env.PORT || 8080 });
