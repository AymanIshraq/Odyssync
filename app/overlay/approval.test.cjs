const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApproval, position, shortUrl } = require('./approval.js');
const { createGhosts } = require('./ghosts.js');
function setup() {
  let now = 0;
  const document = { body: { append() {} }, createElement: () => ({ style: {}, children: [], listeners: {}, setAttribute() {}, append(...nodes) { this.children.push(...nodes); }, remove() { this.removed = true; }, addEventListener(type, cb) { this.listeners[type] = cb; } }) };
  const events = [], hits = [], settled = [];
  const viewport = () => ({ width: 1000, height: 700 });
  const ghosts = createGhosts({ document, viewport, clock: () => now, settled: (...args) => settled.push(args) });
  const approval = createApproval({ document, viewport, ghosts, clock: () => now, api: { answer: (...args) => events.push(args), setInteractive: v => hits.push(v) } });
  return { ghosts, approval, events, hits, settled, send(e) { ghosts.receive(e); approval.receive(e); }, tick(t) { now = t; ghosts.frame(t); approval.frame(t); } };
}
const commit = { type: 'COMMIT', transferId: 'a', edge: 'LEFT', centerRatio: .5, role: 'receiver', mode: 'approval', width: 420, height: 260, fromName: '<script>sender</script>', title: 'Example', url: 'https://example.com/path?secret=hidden' };
test('approval docks 90 DIPs inward, clamps every edge and shortens URL', () => {
  const view = { width: 1000, height: 700 };
  assert.deepEqual(position(commit, view), { x: 90, y: 280, width: 340, height: 140 });
  assert.equal(position({ ...commit, edge: 'RIGHT' }, view).x, 570);
  assert.equal(position({ ...commit, edge: 'TOP' }, view).y, 90);
  assert.equal(position({ ...commit, edge: 'BOTTOM' }, view).y, 470);
  assert.deepEqual(position(commit, { width: 200, height: 100 }), { x: 0, y: 0, width: 200, height: 100 });
  assert.equal(shortUrl(commit.url), 'example.com/path');
});
test('approval waits, hit-tests union, answers once and settles only after acceptance', () => {
  const s = setup(); s.send(commit); s.send({ ...commit, transferId: 'b', edge: 'RIGHT' }); s.tick(260);
  assert.equal(s.settled.length, 0);
  assert.equal(s.ghosts.cards.get('a').current.x, 90);
  s.approval.move({ clientX: 100, clientY: 300 });
  s.approval.move({ clientX: 600, clientY: 300 });
  assert.deepEqual(s.hits, [true]);
  s.approval.move({ clientX: 500, clientY: 10 }); assert.deepEqual(s.hits, [true, false]);
  const card = s.approval.cards.get('a');
  assert.equal(card.node.children[0].textContent, 'Incoming tab from <script>sender</script>');
  card.node.children[3].children[0].listeners.click();
  s.approval.answer('a', true); assert.deepEqual(s.events, [['a', true]]);
  s.tick(520); assert.equal(s.settled.length, 1);
  s.approval.answer('b', false); s.tick(680);
  assert.deepEqual(s.events[1], ['b', false]); assert.equal(s.ghosts.cards.has('b'), false);
});
test('timeout and external rejection clean UI, restore click-through, never accept', () => {
  const s = setup(); s.send(commit); s.tick(260);
  s.approval.move({ clientX: 100, clientY: 300 }); s.tick(30000);
  assert.equal(s.approval.cards.size, 0); assert.deepEqual(s.hits, [true, false]);
  assert.equal(s.events.length, 0); assert.equal(s.settled.length, 0);
  s.tick(30160); assert.equal(s.ghosts.cards.size, 0);
  s.send({ ...commit, transferId: 'b' });
  s.send({ type: 'FAILED', transferId: 'b', role: 'receiver' }); assert.equal(s.approval.cards.size, 0);
});
test('bounce squashes at 80ms, rebounds and cleans up after 340ms on every edge', () => {
  for (const edge of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) {
    const s = setup(); s.send({ ...commit, type: 'BOUNCE', role: 'sender', edge });
    s.tick(80); const c = s.ghosts.cards.get('a');
    assert.equal(c.current.scaleX, .91); assert.equal(c.current.scaleY, 1.04);
    s.tick(250); assert.ok(c.current.scaleX > 1);
    s.tick(420); assert.equal(s.ghosts.cards.size, 0); assert.equal(s.settled.length, 0);
  }
});
