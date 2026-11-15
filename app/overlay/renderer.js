let lastPointer = null;
window.addEventListener('mousemove', event => { lastPointer = { x: event.clientX, y: event.clientY }; });
const ghosts = OverlayGhosts.createGhosts({
  document,
  viewport: () => ({ width: innerWidth, height: innerHeight }),
  settled: (id, rect) => window.odyssync.ghostSettled(id, rect),
  pointer: () => lastPointer,
});
const bezel = OverlayBezel.createBezel({
  document,
  viewport: () => ({ width: innerWidth, height: innerHeight }),
});
const approval = OverlayApproval.createApproval({
  document, viewport: () => ({ width: innerWidth, height: innerHeight }),
  api: window.odyssync, ghosts,
});
const voice = OverlayVoice.createVoice({ document });
window.addEventListener('mousemove', approval.move);
window.addEventListener('mouseleave', approval.leave);
window.addEventListener('blur', approval.leave);
window.addEventListener('pagehide', approval.leave);
window.odyssync.onEvent(event => {
  ghosts.receive(event);
  bezel.receive(event);
  approval.receive(event);
  voice.receive(event);
});
function frame(now) {
  ghosts.frame(now);
  bezel.frame(now);
  approval.frame(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
