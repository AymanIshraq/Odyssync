const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGhosts, fileSize } = require('./ghosts.js');
const { createVoice } = require('./voice.js');
function setup(pointer = () => null) {
  let now = 0;
  const nodes = [], settled = [];
  const document = { body: { append(node) { nodes.push(node); } }, createElement: () => ({ style: {}, dataset: {}, children: [], setAttribute() {}, append(...n) { this.children.push(...n); }, remove() {} }) };
  const ghosts = createGhosts({ document, viewport: () => ({ width: 1000, height: 700 }), pointer, clock: () => now, settled: (...args) => settled.push(args) });
  return { ghosts, document, nodes, settled, tick(t) { now = t; ghosts.frame(t); } };
}
test('voice reuses one passive orb, validates states and hides on idle', () => {
  const s = setup(), voice = createVoice({ document: s.document });
  voice.receive({ type: 'VOICE', state: 'invalid' }); assert.equal(s.nodes.length, 0);
  for (const [state, label] of [['listening', 'Listening'], ['thinking', 'Thinking'], ['speaking', 'Speaking']]) {
    voice.receive({ type: 'VOICE', state });
    assert.equal(s.nodes.length, 1); assert.equal(s.nodes[0].className, 'voice-orb'); assert.equal(voice.label(), label);
    assert.equal(s.nodes[0].dataset.state, state); assert.equal(s.nodes[0].hidden, false);
  }
  voice.receive({ type: 'VOICE', state: 'idle' }); assert.equal(s.nodes[0].hidden, true);
});
test('voice orb keeps a visually hidden aria-live label for screen readers', () => {
  const s = setup(), voice = createVoice({ document: s.document });
  voice.receive({ type: 'VOICE', state: 'listening' });
  const label = s.nodes[0].children.find(n => n.className === 'visually-hidden');
  assert.ok(label); assert.equal(label.textContent, 'Listening');
  assert.equal(s.nodes[0].children.length, 3);
});
test('preview-free direct arrivals enter from each specified edge and settle once', () => {
  for (const edge of ['LEFT', 'RIGHT', 'TOP', 'BOTTOM']) {
    const s = setup();
    s.ghosts.receive({ type: 'COMMIT', transferId: edge, direct: true, role: 'receiver', edge, width: 300, height: 200, mode: 'collaborative', title: 'Direct tab', url: 'https://example.com' });
    const c = s.ghosts.cards.get(edge);
    assert.equal(c.caption.hidden, false); assert.match(c.caption.textContent, /Direct tab/);
    const start = { ...c.current }; s.tick(260);
    assert.equal(s.settled.length, 1);
    assert.ok(c.current.x >= 0 && c.current.y >= 0);
    assert.notDeepEqual([start.x, start.y], [c.current.x, c.current.y]);
    s.tick(520); assert.equal(s.settled.length, 1);
  }
});
test('edge-less direct arrivals choose nearest pointer edge or right fallback', () => {
  for (const [p, edge] of [[{ x: 1, y: 350 }, 'LEFT'], [{ x: 999, y: 350 }, 'RIGHT'], [{ x: 500, y: 1 }, 'TOP'], [{ x: 500, y: 699 }, 'BOTTOM'], [null, 'RIGHT']]) {
    const s = setup(() => p);
    s.ghosts.receive({ type: 'COMMIT', direct: true, transferId: 'a', role: 'receiver' });
    assert.equal(s.ghosts.cards.get('a').event.edge, edge);
  }
});
test('file card uses safe text, icon and size, follows normal lifecycle without preview', () => {
  const s = setup();
  s.ghosts.receive({ type: 'COMMIT', kind: 'file', direct: true, transferId: 'file', role: 'receiver', mode: 'collaborative', edge: 'LEFT', filename: '<img onerror=alert(1)>.pdf', size: 2048 });
  const c = s.ghosts.cards.get('file');
  assert.equal(c.caption.textContent, '\u{1F4C4} <img onerror=alert(1)>.pdf\n2.0 KB');
  assert.equal(c.image.hidden, true);
  s.tick(260); assert.equal(s.settled.length, 1);
  s.ghosts.receive({ type: 'PLACED', transferId: 'file' }); s.tick(380);
  assert.equal(s.ghosts.cards.size, 0);
  assert.equal(fileSize(0), '0 B'); assert.equal(fileSize(1024 ** 2), '1.0 MB');
  assert.equal(fileSize(-1), 'Size unavailable'); assert.equal(fileSize(Infinity), 'Size unavailable');
});
test('direct approval waits for acceptance; focus does not draw or settle', () => {
  const s = setup();
  const e = { type: 'COMMIT', transferId: 'a', direct: true, role: 'receiver', mode: 'approval', edge: 'RIGHT' };
  s.ghosts.receive(e); s.tick(260); assert.equal(s.settled.length, 0);
  assert.equal(s.ghosts.cards.get('a').phase, 'approval');
  s.ghosts.approve('a'); s.tick(520); assert.equal(s.settled.length, 1);
  s.ghosts.receive({ ...e, transferId: 'focus', mode: 'focus' });
  assert.equal(s.ghosts.cards.has('focus'), false); assert.equal(s.settled.length, 1);
});
