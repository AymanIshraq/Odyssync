const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rect, createGhosts } = require('./ghosts.js');
const view = { width: 1000, height: 700 };
const base = { transferId: 'a', edge: 'LEFT', role: 'receiver', width: 200, height: 100, centerRatio: 0.5, protrusionPx: 40, mode: 'collaborative' };
function setup() {
  let now = 0;
  const settled = [];
  const document = { body: { append() {} }, createElement: () => ({ style: {}, append() {}, remove() {} }) };
  const engine = createGhosts({ document, viewport: () => view, clock: () => now, settled: (...args) => settled.push(args) });
  return { ...engine, settled, tick: n => { now = n; engine.frame(n); }, send: (type, extra = {}) => engine.receive({ ...base, type, ...extra }) };
}
test('all four edges retain renderer orientation and clamp along-edge geometry', () => {
  assert.equal(rect(base, view).x, -160);
  assert.equal(rect({ ...base, edge: 'RIGHT' }, view).x, 960);
  assert.equal(rect({ ...base, edge: 'TOP' }, view).y, -60);
  assert.equal(rect({ ...base, edge: 'BOTTOM' }, view).y, 660);
  assert.equal(rect({ ...base, centerRatio: 2 }, view).y, 600);
  assert.equal(rect({ ...base, width: 2000 }, view).width, 1000);
});
test('coalesces latest move, preloads hidden image, and settles once after 260ms', () => {
  const s = setup();
  s.send('PREVIEW', { imageUrl: 'data:image/png;base64,AA' });
  const card = s.cards.get('a');
  assert.equal(card.image.hidden, true);
  card.image.onload();
  assert.equal(card.image.hidden, false);
  s.send('DRAG_MOVE'); s.send('DRAG_MOVE', { protrusionPx: 80 }); s.tick(0);
  assert.match(card.node.style.transform, /-120px/);
  s.send('COMMIT'); s.tick(259); assert.equal(s.settled.length, 0);
  s.tick(260); assert.deepEqual(s.settled, [['a', { x: 0, y: 300, width: 200, height: 100 }]]);
  s.send('COMMIT'); s.tick(600); assert.equal(s.settled.length, 1);
  s.send('PLACED'); s.tick(719); assert.equal(s.cards.size, 1);
  s.tick(720); assert.equal(s.cards.size, 0);
});
test('cancellation, failure, independent transfers and late image completion', () => {
  const s = setup();
  s.send('PREVIEW', { imageUrl: 'data:image/png;base64,AA' });
  const loaded = s.cards.get('a').image.onload;
  s.send('DRAG_MOVE'); s.send('DRAG_MOVE', { transferId: 'b' });
  s.send('CANCEL'); s.tick(160);
  loaded(); assert.equal(s.cards.has('a'), false); assert.equal(s.cards.has('b'), true);
  s.send('FAILED', { transferId: 'b' }); s.tick(320); assert.equal(s.cards.size, 0);
  assert.equal(s.settled.length, 0);
});
test('sender whip and rejection recoil do not acknowledge receiver settlement', () => {
  const s = setup(); s.send('COMMIT', { role: 'sender', protrusionPx: 200 });
  s.tick(160); assert.equal(s.cards.get('a').node.hidden, true);
  s.send('REJECTED', { role: 'sender' }); s.tick(260);
  assert.equal(s.cards.get('a').node.hidden, false);
  s.tick(420); assert.equal(s.cards.size, 0); assert.equal(s.settled.length, 0);
});
test('receiver lifecycle and sender exit work on all four renderer edges', () => {
  for (const edge of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) {
    const s = setup();
    s.send('DRAG_MOVE', { edge }); s.send('COMMIT', { edge }); s.tick(260);
    const r = s.settled[0][1];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= view.width && r.y + r.height <= view.height);
    if (edge === 'LEFT') assert.equal(r.x, 0);
    if (edge === 'RIGHT') assert.equal(r.x, view.width - r.width);
    if (edge === 'TOP') assert.equal(r.y, 0);
    if (edge === 'BOTTOM') assert.equal(r.y, view.height - r.height);
    s.send('PLACED'); s.tick(380); assert.equal(s.cards.size, 0);
    const sender = setup(); sender.send('COMMIT', { edge, role: 'sender', protrusionPx: 200 }); sender.tick(160);
    const out = sender.cards.get('a').current;
    assert.ok(out.x + out.width <= 0 || out.x >= view.width || out.y + out.height <= 0 || out.y >= view.height);
  }
});
