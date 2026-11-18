(function (root) {
  const labels = { idle: 'Voice ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
  function createVoice({ document }) {
    let node, label;
    function receive(event) {
      if (event?.type !== 'VOICE' || !Object.hasOwn(labels, event.state)) return;
      if (!node) {
        // A glowing orb at the bottom centre; the words are kept for screen readers only.
        node = document.createElement('div'); node.className = 'voice-orb';
        const glow = document.createElement('span'); glow.className = 'voice-orb-glow'; glow.setAttribute('aria-hidden', 'true');
        const core = document.createElement('span'); core.className = 'voice-orb-core'; core.setAttribute('aria-hidden', 'true');
        label = document.createElement('output'); label.className = 'visually-hidden';
        label.setAttribute('aria-live', 'polite');
        node.append(glow, core, label); document.body.append(node);
      }
      label.textContent = labels[event.state];
      node.dataset.state = event.state;
      // Idle remains empty to preserve the transparent inactive overlay.
      node.hidden = event.state === 'idle';
    }
    return { receive, label: () => label?.textContent };
  }
  if (typeof module !== 'undefined') module.exports = { createVoice };
  else root.OverlayVoice = { createVoice };
})(globalThis);
