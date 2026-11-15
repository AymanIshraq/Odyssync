(function (root) {
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const edges = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];
  function fileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  function rect(event, viewport, visible) {
    const w = clamp(event.width || 320, 1, viewport.width);
    const h = clamp(event.height || 200, 1, viewport.height);
    const ratio = clamp(event.centerRatio ?? 0.5, 0, 1);
    const vertical = event.edge === 'LEFT' || event.edge === 'RIGHT';
    const amount = visible ?? clamp(event.protrusionPx || 0, 0, vertical ? w : h);
    let x = clamp(ratio * viewport.width - w / 2, 0, viewport.width - w);
    let y = clamp(ratio * viewport.height - h / 2, 0, viewport.height - h);
    if (event.edge === 'LEFT') x = -w + amount;
    if (event.edge === 'RIGHT') x = viewport.width - amount;
    if (event.edge === 'TOP') y = -h + amount;
    if (event.edge === 'BOTTOM') y = viewport.height - amount;
    return { x, y, width: w, height: h, opacity: 1, blur: 0, scaleX: 1, scaleY: 1 };
  }
  // Invert cubic-bezier x(t) for the specified (0.16, 1, 0.3, 1) curve.
  function bezier(p, x1, y1, x2, y2) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const t = (lo + hi) / 2;
      const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
      if (x < p) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2;
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  }
  const spring = p => bezier(p, .16, 1, .3, 1);
  const rebound = p => bezier(p, .34, 1.56, .64, 1);
  function createGhosts({ document, viewport, settled, clock = () => performance.now(), pointer = () => null }) {
    const cards = new Map();
    function remove(card) { card.image.onload = null; card.image.onerror = null; card.node.remove(); cards.delete(card.id); }
    function get(event) {
      let card = cards.get(event.transferId);
      if (!card) {
        const node = document.createElement('div');
        node.className = 'ghost';
        const image = document.createElement('img');
        image.alt = '';
        image.hidden = true;
        node.hidden = true;
        node.append(image);
        const caption = document.createElement('div'); caption.className = 'ghost-caption';
        caption.hidden = true; node.append(caption);
        document.body.append(node);
        card = { id: event.transferId, node, image, caption, event: {}, current: null };
        cards.set(card.id, card);
      }
      return card;
    }
    function animate(card, target, duration, done, curve = p => p) {
      card.animation = { from: { ...card.current }, target, start: clock(), duration, done, curve };
    }
    function receive(event) {
      if (!event || typeof event.transferId !== 'string' || !['PREVIEW', 'DRAG_MOVE', 'CANCEL', 'COMMIT', 'PLACED', 'FAILED', 'REJECTED', 'BOUNCE'].includes(event.type)) return;
      if (event.type !== 'PREVIEW' && !cards.has(event.transferId) && !['DRAG_MOVE', 'COMMIT', 'BOUNCE'].includes(event.type)) return;
      const card = get(event);
      card.event = { ...card.event, ...event };
      const e = card.event;
      if (!edges.includes(e.edge)) {
        const p = pointer(), view = viewport();
        e.edge = p ? [['LEFT', p.x], ['RIGHT', view.width - p.x], ['TOP', p.y], ['BOTTOM', view.height - p.y]].sort((a, b) => a[1] - b[1])[0][0] : 'RIGHT';
      }
      if (event.type === 'PREVIEW') {
        if (typeof event.imageUrl !== 'string' || !/^(data:image\/|blob:|file:)/.test(event.imageUrl)) return;
        const url = event.imageUrl;
        card.image.hidden = true;
        card.image.onload = () => { if (cards.get(card.id) === card && card.event.imageUrl === url && card.event.kind !== 'file') { card.image.hidden = false; card.caption.hidden = true; } };
        card.image.onerror = () => { card.image.hidden = true; };
        card.image.src = url;
        return;
      }
      const view = viewport();
      if (e.kind === 'file' || (event.type === 'COMMIT' && !e.imageUrl)) {
        card.caption.hidden = false;
        card.caption.textContent = e.kind === 'file'
          ? `\u{1F4C4} ${e.filename || 'Incoming file'}\n${fileSize(e.size)}`
          : `${e.title || 'Incoming tab'}\n${e.url || ''}`;
        if (e.kind === 'file') card.image.hidden = true;
      }
      if (!card.current && event.type === 'COMMIT' && e.role === 'sender') {
        const size = rect(e, view);
        card.current = rect(e, view, e.edge === 'LEFT' || e.edge === 'RIGHT' ? size.width : size.height);
      }
      card.current ??= rect(e, view);
      if (event.type === 'BOUNCE') {
        card.node.hidden = false;
        card.phase = 'bounce';
        card.current = rect(e, view, Math.min(90, e.width || 320));
        animate(card, { ...card.current, scaleX: .91, scaleY: 1.04 }, 80, () => {
          animate(card, { ...card.current, scaleX: 1, scaleY: 1 }, 340, () => remove(card), rebound);
        });
      } else if (event.type === 'DRAG_MOVE') {
        if (card.phase && card.phase !== 'drag') return;
        card.phase = 'drag';
        card.current = rect(e, view);
        card.node.hidden = e.role === 'sender';
      } else if (event.type === 'COMMIT') {
        if (['commit', 'settled', 'approval'].includes(card.phase)) return;
        card.node.hidden = false;
        card.phase = 'commit';
        if (e.role === 'sender') {
          animate(card, rect(e, view, 0), 160, () => { card.node.hidden = true; card.phase = 'sent'; });
        } else if (e.mode === 'approval') {
          card.phase = 'approval';
          const size = rect(e, view);
          const target = rect(e, view, (e.edge === 'LEFT' || e.edge === 'RIGHT' ? size.width : size.height) + 90);
          target.x = clamp(target.x, 0, view.width - target.width);
          target.y = clamp(target.y, 0, view.height - target.height);
          animate(card, target, 260, () => {} , spring);
        } else if (!e.mode || e.mode === 'collaborative') {
          const size = rect(e, view);
          const target = rect(e, view, e.edge === 'LEFT' || e.edge === 'RIGHT' ? size.width : size.height);
          card.current.blur = 4;
          animate(card, target, 260, () => {
            card.phase = 'settled';
            const { x, y, width, height } = card.current;
            settled(card.id, { x, y, width, height });
          }, spring);
        } else { remove(card); }
      } else if (event.type === 'PLACED') {
        animate(card, { ...card.current, opacity: 0 }, 120, () => remove(card));
      } else if (e.role === 'sender' && event.type !== 'CANCEL') {
        card.node.hidden = false;
        const size = rect(e, view);
        animate(card, rect(e, view, Math.min(48, size.width, size.height)), 100,
          () => animate(card, rect(e, viewport(), 0), 160, () => remove(card)));
      } else {
        animate(card, rect(e, view, 0), 160, () => remove(card));
      }
    }
    function frame(now) {
      for (const card of cards.values()) {
        if (!card.current) continue;
        const a = card.animation;
        if (a) {
          const p = clamp((now - a.start) / a.duration, 0, 1);
          const eased = p === 1 ? 1 : a.curve(p);
          for (const key of Object.keys(a.target)) card.current[key] = a.from[key] + (a.target[key] - a.from[key]) * eased;
          if (p === 1) { card.animation = null; a.done(); }
        }
        const r = card.current;
        card.node.style.width = `${r.width}px`;
        card.node.style.height = `${r.height}px`;
        card.node.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) scaleX(${r.scaleX}) scaleY(${r.scaleY})`;
        card.node.style.opacity = r.opacity;
        card.node.style.filter = `blur(${r.blur}px)`;
      }
    }
    function approve(id) {
      const card = cards.get(id);
      if (!card || card.phase !== 'approval') return;
      card.phase = 'drag';
      receive({ ...card.event, type: 'COMMIT', mode: 'collaborative' });
    }
    return { receive, frame, cards, approve };
  }
  if (typeof module !== 'undefined') module.exports = { rect, createGhosts, fileSize };
  else root.OverlayGhosts = { rect, createGhosts };
})(globalThis);
