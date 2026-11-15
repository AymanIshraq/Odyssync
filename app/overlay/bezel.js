(function (root) {
  const colors = { collaborative: '#155cf4', approval: '#ff7618', focus: '#ef4444' };
  const edges = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  function geometry(event, view) {
    const vertical = event.edge === 'LEFT' || event.edge === 'RIGHT';
    const length = Math.min(300, vertical ? view.height : view.width);
    const thickness = Math.min(14, vertical ? view.width : view.height);
    const ratio = Number.isFinite(event.centerRatio) ? clamp(event.centerRatio, 0, 1) : 0.5;
    const along = clamp(ratio * (vertical ? view.height : view.width) - length / 2,
      0, (vertical ? view.height : view.width) - length);
    return {
      x: vertical ? (event.edge === 'RIGHT' ? view.width - thickness : 0) : along,
      y: vertical ? along : (event.edge === 'BOTTOM' ? view.height - thickness : 0),
      width: vertical ? thickness : length,
      height: vertical ? length : thickness,
    };
  }
  function createBezel({ document, viewport, clock = () => performance.now() }) {
    const strips = new Map();
    const ripples = new Map();
    function receive(event) {
      if (!event || typeof event.transferId !== 'string') return;
      if (event.type === 'BOUNCE' && edges.includes(event.edge)) {
        const previous = ripples.get(event.transferId);
        if (previous) previous.node.remove();
        const node = document.createElement('div'); node.className = 'bezel ripple';
        document.body.append(node);
        ripples.set(event.transferId, { node, event, start: clock() });
      }
      if (['CANCEL', 'COMMIT', 'PLACED', 'FAILED', 'REJECTED', 'BOUNCE'].includes(event.type)) {
        const strip = strips.get(event.transferId);
        if (strip) { strip.node.remove(); strips.delete(event.transferId); }
        return;
      }
      if (event.type !== 'DRAG_MOVE' || !edges.includes(event.edge) || !['sender', 'receiver'].includes(event.role)) return;
      let strip = strips.get(event.transferId);
      if (!strip) {
        const node = document.createElement('div');
        node.className = 'bezel';
        node.setAttribute('aria-hidden', 'true');
        document.body.append(node);
        strip = { node };
        strips.set(event.transferId, strip);
      }
      strip.event = { ...event };
    }
    function frame(now = clock()) {
      const view = viewport();
      for (const [id, ripple] of ripples) {
        const p = Math.min(1, (now - ripple.start) / 420);
        if (p >= 1) { ripple.node.remove(); ripples.delete(id); continue; }
        const r = geometry(ripple.event, view);
        ripple.node.style.width = `${r.width}px`; ripple.node.style.height = `${r.height}px`;
        ripple.node.style.transform = `translate3d(${r.x}px, ${r.y}px, 0) scale(${1 + p * .5})`;
        ripple.node.style.color = colors.focus; ripple.node.style.opacity = 1 - p;
      }
      for (const { node, event } of strips.values()) {
        const rect = geometry(event, view);
        node.style.width = `${rect.width}px`;
        node.style.height = `${rect.height}px`;
        node.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
        node.style.color = colors[event.mode] || colors.collaborative;
      }
    }
    return { receive, frame, strips };
  }
  if (typeof module !== 'undefined') module.exports = { geometry, createBezel, colors };
  else root.OverlayBezel = { createBezel };
})(globalThis);
