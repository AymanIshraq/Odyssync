(function (root) {
  const labels = { idle: 'Voice ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
  function createVoice({ document }) {
    let node;
    function receive(event) {
      if (event?.type !== 'VOICE' || !Object.hasOwn(labels, event.state)) return;
      if (!node) {
        node = document.createElement('output'); node.className = 'voice-indicator';
        node.setAttribute('aria-live', 'polite'); document.body.append(node);
      }
      node.textContent = labels[event.state];
      node.dataset.state = event.state;
      // Idle remains empty to preserve the transparent inactive overlay.
      node.hidden = event.state === 'idle';
    }
    return { receive };
  }
  if (typeof module !== 'undefined') module.exports = { createVoice };
  else root.OverlayVoice = { createVoice };
})(globalThis);
