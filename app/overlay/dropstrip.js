(function (root) {
  const edges = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];
  function geometry(edge, view) {
    const depth = Math.min(90, edge === 'LEFT' || edge === 'RIGHT' ? view.width : view.height);
    if (edge === 'LEFT') return { x: 0, y: 0, width: depth, height: view.height };
    if (edge === 'RIGHT') return { x: view.width - depth, y: 0, width: depth, height: view.height };
    if (edge === 'TOP') return { x: 0, y: 0, width: view.width, height: depth };
    return { x: 0, y: view.height - depth, width: view.width, height: depth };
  }
  function createDropStrip({ document, viewport, api }) {
    let strip = null;
    // Chromium opens a file dropped anywhere on a page: outside the strip a drop is refused.
    document.addEventListener('dragover', event => {
      if (!event.defaultPrevented && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      event.preventDefault();
    });
    document.addEventListener('drop', event => event.preventDefault());
    function remove() { if (strip) { strip.node.remove(); strip = null; } }
    function receive(e) {
      if (e?.type !== 'FILE_DRAG' || !edges.includes(e.edge)) return;
      if (!e.active) { if (strip && strip.edge === e.edge) remove(); return; }
      if (strip && strip.edge === e.edge) return;
      remove();
      const edge = e.edge;
      const node = document.createElement('div'); node.className = 'drop-strip';
      node.setAttribute('aria-label', 'Drop a file to send it');
      const label = document.createElement('span'); label.textContent = 'Drop to send';
      node.append(label);
      const r = geometry(edge, viewport());
      node.style.left = `${r.x}px`; node.style.top = `${r.y}px`;
      node.style.width = `${r.width}px`; node.style.height = `${r.height}px`;
      node.addEventListener('dragover', event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      });
      node.addEventListener('drop', event => {
        event.preventDefault();
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) api.fileDropped(edge, files[0], files.length);
        remove();
      });
      document.body.append(node);
      strip = { edge, node };
    }
    return { receive, current: () => strip };
  }
  if (typeof module !== 'undefined') module.exports = { createDropStrip, geometry };
  else root.OverlayDropStrip = { createDropStrip };
})(globalThis);
