const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandoff } = require('./handoff');

function sender({ hideSucceeds = true, acknowledge = true } = {}) {
  const native = [], messages = [];
  let onSidecar;
  const state = {
    self: { deviceId: 'sender', profile: { dpiScale: 1, screenWidth: 1920, screenHeight: 1080 } },
    members: [{ deviceId: 'receiver', profile: { displayName: 'Receiver' } }],
    neighbors: { sender: { right: 'receiver' } }, modes: { receiver: 'collaborative' },
  };
  const bridge = {
    onMessage: callback => { onSidecar = callback; },
    send: message => { native.push(message); return message.type !== 'HIDE_WINDOW' || hideSucceeds; },
    isConnected: () => true,
  };
  let handoff;
  const transport = {
    bufferedAmount: () => 0,
    sendBinaryToPeer() {},
    sendToPeer(target, message) {
      messages.push(message);
      if (message.type === 'TRANSFER_COMMIT' && acknowledge) {
        assert.equal(native[0].type, 'HIDE_WINDOW', 'sender must hide before committing');
        handoff.onPeerMessage({ type: 'TRANSFER_ACCEPTED', fromId: 'receiver', transferId: message.transferId });
      }
    },
  };
  handoff = createHandoff({ transport, bridge, getState: () => state, timeouts: { reply: 10 } });
  function drop() {
    onSidecar({ type: 'LOCAL_DRAG_START', hwnd: 10, browser: 'chrome', url: 'https://example.com', tabCount: 1 });
    onSidecar({ type: 'LOCAL_DRAG_MOVE', hwnd: 10, edge: 'RIGHT', width: 900, height: 650,
      protrusionPx: 50, centerRatio: .5, cursorAtEdge: true });
    onSidecar({ type: 'LOCAL_DRAG_END', hwnd: 10, edge: 'RIGHT', cursorAtEdge: true });
  }
  return { native, messages, drop };
}

test('hide happens on release; an immediate acceptance closes without a later restore', async () => {
  const s = sender();
  s.drop();
  assert.deepEqual(s.native.map(message => message.type), ['HIDE_WINDOW', 'CLOSE_WINDOW']);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(s.native.some(message => message.type === 'SHOW_WINDOW'), false);
});

test('a failed hide cancels without opening a receiver copy', () => {
  const s = sender({ hideSucceeds: false });
  s.drop();
  assert.equal(s.messages.some(message => message.type === 'TRANSFER_COMMIT'), false);
  assert.equal(s.native.some(message => message.type === 'CLOSE_WINDOW'), false);
});

test('an unconfirmed delivery restores the original rather than discarding it', async () => {
  const s = sender({ acknowledge: false });
  s.drop();
  assert.equal(s.native[0].type, 'HIDE_WINDOW');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(s.native.map(message => message.type), ['HIDE_WINDOW', 'SHOW_WINDOW']);
});
