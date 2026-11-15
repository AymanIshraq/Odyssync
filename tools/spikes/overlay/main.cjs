const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');

let overlay;
let watchdog;
const replay = process.argv.includes('--ghost-replay');
const stop = () => app.quit();

app.whenReady().then(async () => {
  // Refuse to show a focusless window without a working global escape hatch.
  if (!globalShortcut.register('Control+Alt+Shift+Q', stop)) {
    throw new Error('Stop shortcut Ctrl+Alt+Shift+Q unavailable; refusing to start.');
  }
  watchdog = setTimeout(stop, 5 * 60 * 1000);
  overlay = new BrowserWindow({
    transparent: true,
    frame: false,
    fullscreen: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      ...(replay ? { preload: path.join(__dirname, 'preload-replay.cjs') } : {}),
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  if (replay) {
    ipcMain.on('overlay-replay:interactive', (event, enabled) => {
      if (event.sender === overlay.webContents && typeof enabled === 'boolean') {
        overlay.setIgnoreMouseEvents(!enabled, { forward: true });
      }
    });
    ipcMain.on('overlay-replay:answer', (event, data) => {
      if (event.sender !== overlay.webContents || typeof data?.transferId !== 'string' || typeof data.accepted !== 'boolean') return;
      console.log('REPLAY answer', data.transferId, data.accepted);
      // Simulated placement only; no real browser tab is opened.
      setTimeout(() => {
        if (!overlay.isDestroyed()) overlay.webContents.send('overlay-replay:event', {
          type: data.accepted ? 'PLACED' : 'REJECTED', transferId: data.transferId, role: 'receiver',
        });
      }, 900);
    });
  }
  overlay.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer stopped:', details.reason);
    app.exit(1);
  });
  overlay.webContents.on('unresponsive', () => app.exit(1));
  await overlay.loadFile(replay
    ? path.join(__dirname, '../../../app/overlay/index.html')
    : path.join(__dirname, 'index.html'));
  if (replay) require('./replay.cjs').run(overlay.webContents);
  overlay.showInactive();
  console.log(`Overlay spike PID ${process.pid}. Stop: Ctrl+Alt+Shift+Q. Auto-stop: 5 minutes.`);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', stop);
app.on('will-quit', () => {
  clearTimeout(watchdog);
  globalShortcut.unregisterAll();
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
