const { test } = require('node:test');
const assert = require('node:assert/strict');
const { geometry, createBezel, colors } = require('./bezel.js');
test('four edges: 20 by 300 DIPs, ratio clamping, no edge flipping', () => {
  const view = { width: 1000, height: 700 };
  for (const [edge, x, y, width, height] of [
    ['LEFT', 0, 200, 20, 300], ['RIGHT', 980, 200, 20, 300],
    ['TOP', 350, 0, 300, 20], ['BOTTOM', 350, 680, 300, 20],
  ]) assert.deepEqual(geometry({ edge, centerRatio: .5 }, view), { x, y, width, height });
  assert.equal(geometry({ edge: 'LEFT', centerRatio: -1 }, view).y, 0);
  assert.equal(geometry({ edge: 'TOP', centerRatio: 2 }, view).x, 700);
  assert.deepEqual(geometry({ edge: 'BOTTOM', centerRatio: 1 }, { width: 100, height: 10 }), { x: 0, y: 0, width: 100, height: 10 });
});
test('both roles coalesce movement, track mode/resize, clean up independently', () => {
  let view = { width: 1000, height: 700 };
  const document = { body: { append() {} }, createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true; } }) };
  const b = createBezel({ document, viewport: () => view });
  const send = (transferId, role, mode, centerRatio) => b.receive({ type: 'DRAG_MOVE', transferId, role, mode, edge: 'RIGHT', centerRatio });
  send('a', 'sender', 'collaborative', .1);
  send('b', 'receiver', 'approval', .5);
  send('a', 'sender', 'focus', 1);
  b.frame();
  assert.equal(b.strips.size, 2);
  assert.equal(b.strips.get('a').node.style.color, colors.focus);
  assert.equal(b.strips.get('b').node.style.color, colors.approval);
  assert.equal(b.strips.get('a').node.style.transform, 'translate3d(980px, 400px, 0)');
  view = { width: 800, height: 600 }; b.frame();
  assert.equal(b.strips.get('a').node.style.transform, 'translate3d(780px, 300px, 0)');
  b.receive({ type: 'CANCEL', transferId: 'a' }); assert.equal(b.strips.size, 1);
  b.receive({ type: 'COMMIT', transferId: 'b' }); assert.equal(b.strips.size, 0);
  for (const type of ['PLACED', 'FAILED', 'REJECTED', 'BOUNCE']) {
    send('c', 'receiver', 'collaborative', .5);
    const node = b.strips.get('c').node;
    b.receive({ type, transferId: 'c' }); assert.equal(node.removed, true);
  }
});
