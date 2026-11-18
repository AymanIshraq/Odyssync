const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSendMenu, combineInteractive } = require('./sendmenu.js');

function fakeNode(tag) {
  return {
    tag, className: '', textContent: '', disabled: false, hidden: false, children: [], attrs: {}, listeners: {}, removed: false,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    append(...n) { this.children.push(...n); }, prepend(...n) { this.children.unshift(...n); },
    remove() { this.removed = true; }, addEventListener(t, cb) { this.listeners[t] = cb; },
    get lastChild() { return this.children[this.children.length - 1]; },
    click() { this.listeners.click?.(); },
  };
}
const find = (node, cls, out = []) => { if (node.className?.split(' ').includes(cls)) out.push(node); node.children?.forEach(c => find(c, cls, out)); return out; };
function setup() {
  const docListeners = {}, answers = [], hits = [], timers = [];
  const document = { body: fakeNode('body'), createElement: fakeNode, addEventListener(t, cb) { docListeners[t] = cb; } };
  const want = combineInteractive({ setInteractive: v => hits.push(v) });
  const fakeTimers = { setTimeout(cb, ms) { const t = { cb, ms, cleared: false }; timers.push(t); return t; }, clearTimeout(t) { t.cleared = true; } };
  const menu = createSendMenu({ document, api: { sendMenuAnswer: (...a) => answers.push(a) }, setInteractive: want('sendMenu'), timers: fakeTimers });
  return { menu, document, docListeners, answers, hits, timers, want, card: () => menu.current()?.card };
}
const items = [
  { id: 'i1', number: 1, kind: 'tab', badge: 'WEB', name: 'Docs', detail: 'docs.example.com' },
  { id: 'i2', number: 2, kind: 'document', badge: 'PDF', name: 'Brief.pdf', detail: 'Word' },
  { id: 'i3', number: 3, kind: 'file', badge: 'ZIP', name: 'a.zip', detail: 'Desktop' },
];
const people = [{ deviceId: 'dA', name: 'Ana', mode: 'collaborative' }, { deviceId: 'dB', name: 'Ben', mode: 'focus' }, { deviceId: 'dC', name: 'Cy', mode: 'approval' }];

test('opens a numbered, untouched list and requests clicks; close event releases without answering', () => {
  const s = setup();
  s.menu.receive({ type: 'SEND_MENU', requestId: 'r1', title: 'Select to send', items, people: null, targetDeviceId: 'dA' });
  const rows = find(s.card(), 'sendmenu-row');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.children[0].textContent), ['1', '2', '3']);
  assert.ok(rows.every(r => r.attrs.role === 'checkbox' && r.attrs['aria-checked'] === 'false'));
  assert.equal(find(s.card(), 'warm').length, 1);
  assert.equal(find(s.card(), 'sendmenu-people').length, 0);
  assert.deepEqual(s.hits, [true]);
  const card = s.card();
  s.menu.receive({ type: 'SEND_MENU_CLOSE', requestId: 'other' }); assert.ok(s.menu.current());
  s.menu.receive({ type: 'SEND_MENU_CLOSE', requestId: 'r1' });
  assert.equal(s.menu.current(), null); assert.ok(card.removed);
  assert.deepEqual(s.hits, [true, false]); assert.deepEqual(s.answers, []);
});

test('ticking updates footer wording like the Control Center and sends to the target', () => {
  const s = setup();
  s.menu.receive({ type: 'SEND_MENU', requestId: 'r1', title: 'Select to send', items, people: null, targetDeviceId: 'dA' });
  const rows = find(s.card(), 'sendmenu-row'), [count] = find(s.card(), 'sendmenu-count'), [send] = find(s.card(), 'sendmenu-send');
  assert.equal(count.textContent, 'Nothing selected'); assert.equal(send.textContent, 'Send'); assert.equal(send.disabled, true);
  rows[0].click(); assert.equal(count.textContent, '1 tab selected'); assert.equal(send.textContent, 'Send tab'); assert.equal(send.disabled, false);
  rows[0].click(); rows[1].click(); assert.equal(send.textContent, 'Send file');
  rows[2].click(); assert.equal(rows[2].attrs['aria-checked'], 'true');
  assert.equal(count.textContent, '2 items selected'); assert.equal(send.textContent, 'Send 2 items');
  send.click();
  assert.deepEqual(s.answers, [['r1', { itemIds: ['i2', 'i3'], deviceId: 'dA' }]]);
  assert.equal(s.menu.current(), null); assert.deepEqual(s.hits, [true, false]);
});

test('Send to pills: single choice, focus disabled, send needs items and a person', () => {
  const s = setup();
  s.menu.receive({ type: 'SEND_MENU', requestId: 'r2', title: 'Select to send', items, people, targetDeviceId: null });
  const pills = find(s.card(), 'sendmenu-pill'), rows = find(s.card(), 'sendmenu-row'), [send] = find(s.card(), 'sendmenu-send');
  assert.equal(find(s.card(), 'sendmenu-people-label')[0].textContent, 'Send to');
  assert.ok(pills.every(p => p.attrs.role === 'radio'));
  assert.equal(pills[1].disabled, true); assert.equal(find(pills[1], 'sendmenu-focus')[0].textContent, 'Focus');
  rows[0].click(); assert.equal(send.disabled, true);
  pills[1].click(); assert.equal(pills[1].attrs['aria-checked'], 'false'); assert.equal(send.disabled, true);
  pills[0].click(); pills[2].click();
  assert.deepEqual(pills.map(p => p.attrs['aria-checked']), ['false', 'false', 'true']);
  assert.equal(send.disabled, false);
  send.click(); assert.deepEqual(s.answers, [['r2', { itemIds: ['i1'], deviceId: 'dC' }]]);
});

test('people-only picker answers on the first person click', () => {
  const s = setup();
  s.menu.receive({ type: 'SEND_MENU', requestId: 'r3', title: 'Send report.docx to…', items: null, people, targetDeviceId: null });
  assert.equal(find(s.card(), 'sendmenu-title')[0].textContent, 'Send report.docx to…');
  assert.equal(find(s.card(), 'sendmenu-footer').length, 0);
  assert.equal(find(s.card(), 'sendmenu-people-label').length, 0);
  find(s.card(), 'sendmenu-pill')[0].click();
  assert.deepEqual(s.answers, [['r3', { itemIds: null, deviceId: 'dA' }]]);
  assert.deepEqual(s.hits, [true, false]);
});

test('Esc, click outside and the close button cancel with null, once', () => {
  for (const how of ['esc', 'outside', 'x']) {
    const s = setup();
    s.menu.receive({ type: 'SEND_MENU', requestId: 'c', title: 'T', items, people, targetDeviceId: null });
    if (how === 'esc') { s.docListeners.keydown({ key: 'a' }); assert.equal(s.answers.length, 0); s.docListeners.keydown({ key: 'Escape' }); }
    if (how === 'outside') s.menu.current().backdrop.click();
    if (how === 'x') find(s.card(), 'sendmenu-close')[0].click();
    assert.deepEqual(s.answers, [['c', null]]); assert.deepEqual(s.hits, [true, false]);
    s.docListeners.keydown({ key: 'Escape' }); assert.equal(s.answers.length, 1);
  }
});

test('a newer menu cancels the older one and stays interactive', () => {
  const s = setup();
  s.menu.receive({ type: 'SEND_MENU', requestId: 'old', title: 'T', items, people: null, targetDeviceId: 'dA' });
  s.menu.receive({ type: 'SEND_MENU', requestId: 'new', title: 'T', items, people: null, targetDeviceId: 'dA' });
  assert.deepEqual(s.answers, [['old', null]]); assert.equal(s.menu.current().requestId, 'new');
  assert.deepEqual(s.hits, [true, false, true]);
});

test('clicks stay on while approval or the menu still wants them', () => {
  const s = setup(), approval = s.want('approval');
  approval(true); assert.deepEqual(s.hits, [true]);
  s.menu.receive({ type: 'SEND_MENU', requestId: 'r', title: 'T', items: null, people, targetDeviceId: null });
  approval(false); assert.deepEqual(s.hits, [true]);
  s.menu.receive({ type: 'SEND_MENU_CLOSE' }); assert.deepEqual(s.hits, [true, false]);
  approval(false); assert.deepEqual(s.hits, [true, false]);
});

test('voice toast shows text for 4 s and a new toast replaces the old one', () => {
  const s = setup();
  s.menu.receive({ type: 'VOICE_TOAST', text: '<b>Sent</b> to Ana' });
  const first = s.menu.toast();
  assert.equal(first.textContent, '<b>Sent</b> to Ana'); assert.equal(s.timers[0].ms, 4000);
  s.menu.receive({ type: 'VOICE_TOAST', text: 'Nobody named Zed' });
  assert.ok(first.removed); assert.ok(s.timers[0].cleared);
  const second = s.menu.toast(); assert.equal(second.textContent, 'Nobody named Zed');
  s.timers[1].cb(); assert.ok(second.removed); assert.equal(s.menu.toast(), null);
  assert.deepEqual(s.hits, []); assert.deepEqual(s.answers, []);
});
