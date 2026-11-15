const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createTransport } = require('./transport');
const { createHandoff } = require('./handoff');
const { start } = require('../server/server');

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for file delivery');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const local of [false, true]) {
  test(`Explorer and document bytes round-trip through ${local ? 'local' : 'relay'} sockets`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssync-wire-'));
    const server = start({ port: 0, local });
    await once(server, 'listening');
    const lane = local ? 'local' : 'cloud';
    const peers = [];
    t.after(async () => {
      for (const p of peers) {
        p.state.members = [];
        p.handoff.roomChanged();
        p.transport.close(lane);
      }
      for (const socket of server.clients) socket.terminate();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const profile = { displayName: 'Test', screenWidth: 1200, screenHeight: 800, dpiScale: 1.5 };
    for (const id of ['aaaaaaaa', 'bbbbbbbb']) {
      const p = { id, transport: createTransport(id), replies: [], events: [], opens: [], saves: [] };
      peers.push(p);
      const other = id === 'aaaaaaaa' ? 'bbbbbbbb' : 'aaaaaaaa';
      p.state = { self: { deviceId: id, profile }, members: [id, other].map(deviceId => ({ deviceId, profile })),
        neighbors: { [id]: { right: other } }, modes: { [id]: 'collaborative', [other]: 'collaborative' } };
      p.handoff = createHandoff({ transport: p.transport, getState: () => p.state,
        downloadsDir: path.join(dir, id), revealFile: file => p.saves.push(file),
        bridge: { isConnected: () => true, onMessage: cb => { p.native = cb; }, send: msg => {
          if (msg.type === 'OPEN_FILE') {
            p.opens.push(msg);
            queueMicrotask(() => p.native({ type: 'WINDOW_PLACED', transferId: msg.transferId, hwnd: 20 }));
          }
          return true;
        } },
        overlay: { onFileDropped: cb => { p.drop = cb; }, onGhostSettled: cb => { p.settle = cb; }, send: e => {
          p.events.push(e);
          if (e.type === 'COMMIT' && e.role === 'receiver') queueMicrotask(() =>
            p.settle(e.transferId, { x: 0, y: 0, width: 700, height: 500 }));
        } },
      });
      p.transport.onMessage((msg, bytes) => { p.replies.push(msg); p.handoff.onPeerMessage(msg, bytes); });
      assert.equal(await p.transport.connect(lane, `ws://127.0.0.1:${server.address().port}`), true);
    }
    const [a, b] = peers;
    a.transport.sendToServer(lane, { type: 'CREATE_ROOM', roomNumber: '123456', pin: '1234', profile });
    await until(() => a.replies.some(m => m.type === 'ROOM_CREATED'));
    b.transport.sendToServer(lane, { type: 'JOIN_ROOM', roomNumber: '123456', pin: '1234', profile });
    await until(() => b.replies.some(m => m.type === 'JOIN_ACCEPTED'));
    if (local) await until(() => a.transport.localPeers().includes(b.id) && b.transport.localPeers().includes(a.id));
    const file = path.join(dir, 'payload.txt');
    const bytes = Buffer.alloc(256 * 1024, 0x61);
    fs.writeFileSync(file, bytes);
    for (const [sender, receiver] of [[a, b], [b, a]]) {
      sender.drop('RIGHT', file, 1);
      await until(() => receiver.saves.length === 1);
      assert.deepEqual(fs.readFileSync(receiver.saves[0]), bytes);
      sender.native({ type: 'LOCAL_DRAG_START', hwnd: 10, kind: 'document', path: file, app: 'notepad.exe' });
      sender.native({ type: 'LOCAL_DRAG_MOVE', hwnd: 10, edge: 'RIGHT', centerRatio: .5, width: 900, height: 600, protrusionPx: 80 });
      sender.native({ type: 'LOCAL_DRAG_END', hwnd: 10, edge: 'RIGHT', cursorAtEdge: true });
      await until(() => receiver.opens.length === 1 && sender.events.filter(e => e.type === 'PLACED' && e.role === 'sender').length === 2);
      assert.deepEqual(fs.readFileSync(receiver.opens[0].path), bytes);
      assert.equal(receiver.opens[0].width, 1050); // overlay DIPs -> receiver physical pixels
      assert.notEqual(receiver.opens[0].path, receiver.saves[0]); // unique name
    }
  });
}
