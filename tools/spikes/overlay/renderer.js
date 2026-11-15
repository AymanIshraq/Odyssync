const box = document.getElementById('box');
const fps = document.getElementById('fps');
let width = window.innerWidth;
let height = window.innerHeight;
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
});

let started;
let sampleStarted;
let frames = 0;
function animate(now) {
  started ??= now;
  sampleStarted ??= now;
  const seconds = (now - started) / 1000;
  const x = (Math.sin(seconds * 0.8) + 1) / 2 * Math.max(0, width - 96);
  // Reach all the way to the bottom so taskbar stacking is observable.
  const y = (Math.sin(seconds * 0.5) + 1) / 2 * Math.max(0, height - 96);
  box.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  frames += 1;
  const elapsed = now - sampleStarted;
  if (elapsed >= 1000) {
    fps.textContent = `${(frames * 1000 / elapsed).toFixed(1)} FPS (rAF)\nStop: Ctrl+Alt+Shift+Q\nAuto-stop: 5 minutes`;
    frames = 0;
    sampleStarted = now;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
