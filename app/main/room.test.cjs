const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { createRoomManager, activeEdges } = require('./room');
const { start } = require('../server/server');

async function freePort() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function waitUntil(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for room/handoff state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function laptop(relayUrl, localPort, name) {
  let onSidecar, onGhostSettled;
  const native = [], events = [];
  const manager = createRoomManager({
    relayUrl, localPort,
    profile: { displayName: name, screenWidth: 1920, screenHeight: 1080, dpiScale: 1 },
    bridge: {
      onMessage: callback => { onSidecar = callback; },
      isConnected: () => true,
      send(message) {
        native.push(message);
        if (message.type === 'OPEN_URL') queueMicrotask(() => onSidecar({
          type: 'WINDOW_PLACED', transferId: message.transferId, hwnd: 99,
        }));
        return true;
      },
    },
    overlay: {
      onAnswer() {},
      onGhostSettled: callback => { onGhostSettled = callback; },
      send(event) {
        events.push(event);
        if (event.type === 'COMMIT' && event.role === 'receiver') queueMicrotask(() =>
          onGhostSettled(event.transferId, { x: 0, y: 100, width: 700, height: 500 }));
      },
    },
  });
  function drop(edge) {
    onSidecar({ type: 'LOCAL_DRAG_START', hwnd: 10, browser: 'chrome',
      url: 'https://example.com', tabCount: 1 });
    onSidecar({ type: 'LOCAL_WINDOW_PREVIEW', hwnd: 10, mime: 'image/jpeg', width: 2, height: 2 }, Buffer.from('test-image'));
    onSidecar({ type: 'LOCAL_DRAG_MOVE', hwnd: 10, edge, width: 700, height: 500,
      protrusionPx: 40, centerRatio: .5, cursorAtEdge: true });
    onSidecar({ type: 'LOCAL_DRAG_END', hwnd: 10, edge, cursorAtEdge: true });
  }
  return { manager, drop, native, events };
}

for (const direct of [false, true]) {
  test(`repeated host/member handoffs both ways over ${direct ? 'direct IP' : 'relay'}`, async () => {
    const relay = start({ port: 0, local: false });
    await once(relay, 'listening');
    const relayUrl = `ws://127.0.0.1:${relay.address().port}`;
    const localPort = await freePort();
    const host = laptop(relayUrl, localPort, 'Host');
    let member;
    try {
      const room = await host.manager.createRoom();
      member = laptop(relayUrl, localPort, 'Member');
      assert.deepEqual(await member.manager.joinRoom({ ...room, ...(direct ? { directIp: '127.0.0.1' } : {}) }), { ok: true });
      await waitUntil(() => activeEdges(host.manager.getState()).right && activeEdges(member.manager.getState()).left);
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const [sender, receiver, edge] of [[host, member, 'RIGHT'], [member, host, 'LEFT']]) {
          sender.native.length = 0;
          receiver.events.length = 0;
          receiver.native.length = 0;
          sender.drop(edge);
          await waitUntil(() => sender.native.some(message => message.type === 'CLOSE_WINDOW'));
          assert.ok(receiver.events.some(event => event.type === 'PREVIEW' && event.role === 'receiver'));
          assert.equal(receiver.native.filter(message => message.type === 'OPEN_URL').length, 1);
          assert.deepEqual(sender.native.map(message => message.type), ['HIDE_WINDOW', 'CLOSE_WINDOW']);
        }
      }
    } finally {
      if (member) await member.manager.leaveRoom();
      await host.manager.leaveRoom();
      for (const socket of relay.clients) socket.terminate();
      await new Promise(resolve => relay.close(resolve));
    }
  });
}

test('host retains a member announced immediately after room creation', async () => {
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  const localPort = await freePort();
  const peer = { deviceId: '1234abcd', profile: {
    displayName: 'Member', screenWidth: 1920, screenHeight: 1080, dpiScale: 1,
  } };
  const received = [];
  relay.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw);
    received.push(message);
    if (message.type === 'CREATE_ROOM') {
      // Both frames arrive before the host finishes starting its local server.
      socket.send(JSON.stringify({ type: 'ROOM_CREATED' }));
      socket.send(JSON.stringify({ type: 'MEMBER_JOINED', member: peer }));
    }
  }));
  let onSidecar;
  const native = [];
  const manager = createRoomManager({
    relayUrl: `ws://127.0.0.1:${relay.address().port}`, localPort,
    profile: { displayName: 'Host', screenWidth: 1920, screenHeight: 1080, dpiScale: 1 },
    bridge: {
      onMessage: callback => { onSidecar = callback; },
      send: message => { native.push(message); return true; },
      isConnected: () => true,
    },
  });
  try {
    await manager.createRoom();
    const state = manager.getState();
    assert.ok(state.members.some(member => member.deviceId === peer.deviceId));
    assert.equal(activeEdges(state).right, true);
    onSidecar({ type: 'LOCAL_DRAG_START', hwnd: 10, browser: 'chrome',
      url: 'https://example.com', tabCount: 1 });
    onSidecar({ type: 'LOCAL_DRAG_MOVE', hwnd: 10, edge: 'RIGHT',
      width: 700, height: 500, protrusionPx: 40, centerRatio: .5, cursorAtEdge: true });
    onSidecar({ type: 'LOCAL_DRAG_END', hwnd: 10, edge: 'RIGHT', cursorAtEdge: true });
    const deadline = Date.now() + 1000;
    while (!received.some(message => message.type === 'TRANSFER_COMMIT') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(received.some(message => message.type === 'TRANSFER_COMMIT' && message.toId === peer.deviceId));
    assert.equal(native[0].type, 'HIDE_WINDOW');
  } finally {
    await manager.leaveRoom();
    for (const socket of relay.clients) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});
