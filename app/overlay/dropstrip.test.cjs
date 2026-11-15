const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDropStrip } = require('./dropstrip.js');
function setup() {
  const nodes = [], dropped = [], docListeners = {};
  const document = {
    addEventListener(type, cb) { docListeners[type] = cb; },
    body: { append(node) { nodes.push(node); } },
    createElement: () => ({ style: {}, children: [], listeners: {}, setAttribute() {}, append(n) { this.children.push(n); }, remove() { this.removed = true; }, addEventListener(type, cb) { this.listeners[type] = cb; } }),
  };
  const strip = createDropStrip({ document, viewport: () => ({ width: 1000, height: 700 }), api: { fileDropped: (...args) => dropped.push(args) } });
  const live = () => nodes.filter(n => !n.removed);
  const event = (files) => ({ defaultPrevented: false, dataTransfer: { files, dropEffect: 'move' }, preventDefault() { this.defaultPrevented = true; } });
  return { strip, nodes, live, dropped, docListeners, event };
}
test('drop strip appears 90 DIPs deep on each edge and goes on inactive', () => {
  const boxes = { LEFT: ['0px', '0px', '90px', '700px'], RIGHT: ['910px', '0px', '90px', '700px'], TOP: ['0px', '0px', '1000px', '90px'], BOTTOM: ['0px', '610px', '1000px', '90px'] };
  for (const [edge, box] of Object.entries(boxes)) {
    const s = setup();
    s.strip.receive({ type: 'FILE_DRAG', role: 'sender', edge, active: true });
    assert.equal(s.live().length, 1);
    const { left, top, width, height } = s.live()[0].style;
    assert.deepEqual([left, top, width, height], box);
    assert.equal(s.live()[0].children[0].textContent, 'Drop to send');
    s.strip.receive({ type: 'FILE_DRAG', role: 'sender', edge, active: false });
    assert.equal(s.live().length, 0);
  }
});
test('one strip at a time; ignores other events and inactive for another edge', () => {
  const s = setup();
  s.strip.receive({ type: 'COMMIT', transferId: 'a', edge: 'LEFT' });
  s.strip.receive({ type: 'FILE_DRAG', edge: 'NOWHERE', active: true });
  assert.equal(s.nodes.length, 0);
  s.strip.receive({ type: 'FILE_DRAG', edge: 'LEFT', active: true });
  s.strip.receive({ type: 'FILE_DRAG', edge: 'TOP', active: true });
  assert.equal(s.live().length, 1); assert.equal(s.strip.current().edge, 'TOP');
  s.strip.receive({ type: 'FILE_DRAG', edge: 'LEFT', active: false });
  assert.equal(s.strip.current().edge, 'TOP');
});
test('drop on the strip sends edge, first file and count, then removes it', () => {
  const s = setup();
  s.strip.receive({ type: 'FILE_DRAG', edge: 'RIGHT', active: true });
  const node = s.live()[0], over = s.event([]);
  node.listeners.dragover(over); s.docListeners.dragover(over);
  assert.equal(over.defaultPrevented, true); assert.equal(over.dataTransfer.dropEffect, 'copy');
  const fileA = { name: 'a.txt' }, fileB = { name: 'b.txt' }, drop = s.event([fileA, fileB]);
  node.listeners.drop(drop);
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(s.dropped, [['RIGHT', fileA, 2]]); assert.equal(s.live().length, 0);
  s.strip.receive({ type: 'FILE_DRAG', edge: 'RIGHT', active: true });
  s.live()[0].listeners.drop(s.event([]));
  assert.equal(s.dropped.length, 1); assert.equal(s.live().length, 0);
});
test('drag and drop outside the strip are refused', () => {
  const s = setup();
  const over = s.event([{ name: 'x' }]), drop = s.event([{ name: 'x' }]);
  s.docListeners.dragover(over); s.docListeners.drop(drop);
  assert.equal(over.defaultPrevented, true); assert.equal(over.dataTransfer.dropEffect, 'none');
  assert.equal(drop.defaultPrevented, true); assert.equal(s.dropped.length, 0);
});
