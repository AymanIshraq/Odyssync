(function (root) {
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  function position(e, view) {
    const width = Math.min(340, view.width), height = Math.min(140, view.height);
    const ratio = Number.isFinite(e.centerRatio) ? clamp(e.centerRatio, 0, 1) : .5;
    let x = ratio * view.width - width / 2, y = ratio * view.height - height / 2;
    if (e.edge === 'LEFT') x = 90;
    if (e.edge === 'RIGHT') x = view.width - width - 90;
    if (e.edge === 'TOP') y = 90;
    if (e.edge === 'BOTTOM') y = view.height - height - 90;
    return { x: clamp(x, 0, view.width - width), y: clamp(y, 0, view.height - height), width, height };
  }
  function shortUrl(value) {
    try { const url = new URL(value); return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 70); }
    catch { return 'URL unavailable'; }
  }
  function createApproval({ document, viewport, api, ghosts, clock = () => performance.now() }) {
    const cards = new Map();
    let pointer = null, interactive = false;
    function hitTest() {
      const hit = pointer && [...cards.values()].some(c => {
        const r = position(c.event, viewport());
        return pointer.x >= r.x && pointer.x < r.x + r.width && pointer.y >= r.y && pointer.y < r.y + r.height;
      });
      if (!!hit !== interactive) { interactive = !!hit; api.setInteractive(interactive); }
    }
    function remove(id) { const c = cards.get(id); if (c) { c.node.remove(); cards.delete(id); hitTest(); } }
    function answer(id, accepted) {
      if (!cards.has(id)) return;
      remove(id);
      api.answer(id, accepted);
      if (accepted) ghosts.approve(id);
      else ghosts.receive({ type: 'REJECTED', transferId: id, role: 'receiver' });
    }
    function receive(e) {
      if (!e || typeof e.transferId !== 'string') return;
      if (['CANCEL', 'PLACED', 'FAILED', 'REJECTED', 'BOUNCE'].includes(e.type)) { remove(e.transferId); return; }
      if (e.type !== 'COMMIT' || e.mode !== 'approval' || e.role !== 'receiver' || cards.has(e.transferId)) return;
      const node = document.createElement('section'); node.className = 'approval';
      node.setAttribute('aria-label', 'Incoming tab approval');
      const heading = document.createElement('div'); heading.className = 'approval-heading';
      heading.textContent = `Incoming ${e.kind === 'file' ? 'file' : 'tab'} from ${e.fromName || 'another device'}`;
      const title = document.createElement('div'); title.className = 'approval-title'; title.textContent = e.filename || e.title || 'Untitled tab';
      const url = document.createElement('div'); url.className = 'approval-url';
      url.textContent = e.kind === 'file' ? (Number.isFinite(e.size) && e.size >= 0 ? `${e.size} bytes` : 'Size unavailable') : shortUrl(e.url);
      url.title = typeof e.url === 'string' ? e.url : '';
      const actions = document.createElement('div'); actions.className = 'approval-actions';
      for (const [label, accepted] of [['Accept', true], ['Reject', false]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => answer(e.transferId, accepted)); actions.append(button);
      }
      node.append(heading, title, url, actions); document.body.append(node);
      cards.set(e.transferId, { event: { ...e }, node, expires: clock() + 30000 }); hitTest();
    }
    function move(event) { pointer = { x: event.clientX, y: event.clientY }; hitTest(); }
    function leave() { pointer = null; hitTest(); }
    function frame(now) {
      for (const [id, c] of cards) {
        if (now >= c.expires) {
          // Main owns the timeout rejection and sender restoration. Expire local UI only.
          remove(id); ghosts.receive({ type: 'REJECTED', transferId: id, role: 'receiver' }); continue;
        }
        const r = position(c.event, viewport());
        c.node.style.width = `${r.width}px`; c.node.style.height = `${r.height}px`;
        c.node.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      }
      hitTest();
    }
    return { receive, frame, move, leave, answer, cards };
  }
  if (typeof module !== 'undefined') module.exports = { createApproval, position, shortUrl };
  else root.OverlayApproval = { createApproval };
})(globalThis);
