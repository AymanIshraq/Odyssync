// Electron entry: creates the Control Center window and the overlay window.
const path = require('path');
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const sidecarBridge = require('./sidecar-bridge');
const os = require('os');
const room = require('./room');
const config = require('../config.json');

let controlWin = null;
let overlayWin = null;
let manager = null;

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Odyssync',
    webPreferences: { preload: path.join(__dirname, 'preload-control.js') },
  });
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'index.html'));
  // Closing the Control Center quits the app (the overlay cannot be closed by hand).
  controlWin.on('closed', () => app.quit());
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
    webPreferences: { preload: path.join(__dirname, 'preload-overlay.js') },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through
  overlayWin.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'));
}

app.whenReady().then(() => {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const profile = { displayName: os.hostname(), screenWidth: size.width, screenHeight: size.height, dpiScale: scaleFactor };
  manager = room.createRoomManager({ relayUrl: config.relayUrl, localPort: config.localPort, profile, bridge: sidecarBridge, overlay: room.wireOverlay(ipcMain, () => overlayWin) });
  room.wireIpc(ipcMain, () => controlWin, manager);
  manager.onState((state) => sidecarBridge.setActiveEdges(room.activeEdges(state)));
  createControlWindow();
  createOverlayWindow();
  sidecarBridge.start();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => manager && manager.leaveRoom()); // others see us leave at once
app.on('before-quit', () => sidecarBridge.stop());

module.exports = {
  getControlWindow: () => controlWin,
  getOverlayWindow: () => overlayWin,
};
