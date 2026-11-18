// Electron entry: creates the Control Center window and the overlay window.
const path = require('path');
const { app, BrowserWindow, screen, ipcMain, shell, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const sidecarBridge = require('./sidecar-bridge');
const os = require('os');
const room = require('./room');
const { createVoice } = require('./voice');
const config = require('../config.json');

let controlWin = null;
let overlayWin = null;
let manager = null;
let voice = null;
let tray = null; // kept here so it is not thrown away
let quitting = false; // true once the tidy-up has started
let tidied = false; // true once it has finished: now the app may really quit

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Odyssync',
    webPreferences: { preload: path.join(__dirname, 'preload-control.js') },
  });
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'index.html'));
  // Closing the Control Center only hides it: Odyssync keeps running in the tray
  // (for the voice assistant). Quit from the tray menu really quits.
  controlWin.on('close', (e) => { if (!quitting) { e.preventDefault(); controlWin.hide(); } });
  controlWin.on('closed', () => { controlWin = null; });
}

function showControlWindow() {
  if (!controlWin) createControlWindow();
  controlWin.show();
  controlWin.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'control', 'assets', 'favicon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Odyssync');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Odyssync', click: showControlWindow },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', showControlWindow); // Windows: a left click opens it too
}

function createOverlayWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  overlayWin = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    // Windows uses true fullscreen (flags from plan/ui2-overlay.md). On a Mac,
    // fullscreen would open a separate Space, so we just cover the display.
    fullscreen: process.platform === 'win32',
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    // Keep drawing even when the system thinks the overlay is in the background, or its animations can stall.
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), backgroundThrottling: false },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through
  overlayWin.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
}

app.whenReady().then(() => {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const profile = { displayName: os.hostname(), screenWidth: size.width, screenHeight: size.height, dpiScale: scaleFactor };
  const overlay = room.wireOverlay(ipcMain, () => overlayWin);
  manager = room.createRoomManager({ relayUrl: config.relayUrl, localPort: config.localPort, profile, bridge: sidecarBridge, overlay, revealFile: (p) => shell.showItemInFolder(p), openFile: (p) => shell.openPath(p) });
  room.wireIpc(ipcMain, () => controlWin, manager);
  manager.onState((state) => sidecarBridge.setActiveEdges(room.activeEdges(state)));
  createControlWindow();
  createOverlayWindow();
  createTray();
  voice = createVoice({ manager, overlay, ipcMain, globalShortcut, BrowserWindow, appDir: path.join(__dirname, '..'), config, notify: (text) => console.log('[voice] ' + text) });
  sidecarBridge.start();
});

// Keep running with no window open (tray app); only Quit ends it.
app.on('window-all-closed', () => {});
app.on('activate', () => { if (manager) showControlWindow(); }); // Mac: clicking the dock icon
app.on('will-quit', () => { if (voice) voice.stop(); });
app.on('before-quit', (e) => {
  if (tidied) return;
  e.preventDefault(); // wait: the sidecar may need a moment to show hidden windows
  if (quitting) return; // a second quit request while we wait: keep waiting
  quitting = true;
  const finish = () => { tidied = true; setImmediate(() => app.quit()); };
  try { if (manager) manager.leaveRoom(); } catch (err) { console.log('[app] leave on quit failed: ' + err.message); } // others see us leave at once
  try { sidecarBridge.stop(finish); } catch (err) { console.log('[app] sidecar stop failed: ' + err.message); finish(); }
});

module.exports = {
  getControlWindow: () => controlWin,
  getOverlayWindow: () => overlayWin,
  getVoice: () => voice,
  getTray: () => tray,
};
