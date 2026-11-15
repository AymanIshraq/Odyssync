// Replay tool: starts the normal app, then plays a hand-written fake drag
// (a JSON file) into the overlay window on a loop, so the overlay can be built
// before the real networking exists.
// Run: cd app && npx electron ../tools/replay.js ../tools/fake-drag.json
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getOverlayWindow } = require('../app/main/index.js'); // starts both windows

// The JSON file from the command line, or fake-drag.json next to this file.
const file = path.resolve(process.argv[2] || path.join(__dirname, 'fake-drag.json'));
const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
let timers = [];

// Play every event at its time, then wait 2 seconds and play again.
function play(win) {
  timers.forEach(clearTimeout); // forget any pass that was still running
  console.log(`[replay] playing ${entries.length} events from ${file}`);
  timers = entries.map((entry) => setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send('overlay:event', entry.event);
  }, entry.at));
  const end = entries[entries.length - 1].at + 2000;
  timers.push(setTimeout(() => { if (!win.isDestroyed()) play(win); }, end));
}

app.whenReady().then(() => {
  const win = getOverlayWindow();
  // Start each time the overlay page loads, so a reload restarts the movie.
  win.webContents.on('did-finish-load', () => play(win));
  if (!win.webContents.isLoading()) play(win); // it may have loaded already
});
