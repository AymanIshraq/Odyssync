// Handoff: the tab-handoff state machine (plan/contract.md, "Sender rules" and
// "Receiver rules"), and the file transfer (a file dropped on the overlay's drop
// strip goes to the neighbour's Downloads\Odyssync folder). A dragged DOCUMENT
// window (a local file open in the browser, Notepad, Word...) travels as a file
// that the neighbour saves and then opens where the picture stopped (a code editor's
// window stays here and only its file goes, to open in the same editor). As SENDER it turns
// this laptop's sidecar drag reports into
// network messages and overlay events; as RECEIVER it turns other laptops'
// messages into overlay events and sidecar commands, and answers the sender.
// Units: the sidecar speaks physical pixels; the network and the overlay use
// DIPs. Network `edge` is always the sender's edge; overlay events get THIS
// screen's edge. No Electron in here, so it can be tested with plain `node`.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const MOVE_MS = 16; // EDGE_DRAG_MOVE at most once per 16 ms
const MAX_BUFFERED = 64 * 1024; // bytes waiting on the socket before we hold moves back
const DEFAULT_TIMEOUTS = {
  reply: 5000, // sender: no answer in 5 s -> window comes back
  replyApproval: 35000, // the same, when the receiver is in approval mode
  approval: 30000, // receiver: no Accept/Reject in 30 s -> rejected
  ghost: 500, // receiver: wait this long for the overlay's ghostSettled (its animation takes about 0.26 s)
  open: 4300, // receiver: wait for the sidecar's answer (it tries for 4 s); ghost + this stays under the sender's 5 s
  fileReply: 90000, // payload (60 s) + cold document startup (20 s) + animation/margin
  fileReplyApproval: 120000, // plus 30 s for approval
  filePayload: 60000, // receiver: the file's bytes must arrive within 60 s of its commit
  documentOpen: 20000, // Office and VS Code can take longer than a warm browser
};
const OPPOSITE = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' };
const MAX_FILE = 50 * 1024 * 1024; // FILE_PAYLOAD is at most 50 MB
// Files we are willing to open by themselves after receiving them. Anything else
// (programs, scripts, macro documents, web pages) is only saved and shown in its folder.
const OPENABLE = new Set(['.pdf', '.txt', '.md', '.log', '.csv', '.json', '.xml', '.rtf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']);
// Code editors. Dragging one of their windows sends the file in its active tab, the window
// itself stays here, and the neighbour opens the file in the same editor. An editor only
// shows a file, it never runs it, so any type of file may be opened in one.
const EDITORS = new Set(['code.exe', 'cursor.exe']);
const DOCUMENT_APPS = new Set([...EDITORS, 'notepad.exe', 'winword.exe', 'excel.exe', 'powerpnt.exe']);
const DROP_END_MS = 300; // the drop reaches the overlay about when the button goes up: keep the strip this long
const DROP_START_MS = 200; // a plain click near the edge looks like a drag for a moment: wait this long before showing the strip

// A name that is safe to save on Windows: no folder parts, no illegal characters,
// no trailing dots or spaces, no device name like CON; "file" if nothing is left.
function safeName(name) {
  let s = path.win32.basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  return s || 'file';
}

// Write the bytes as dir/name, else "name (1).ext", "name (2).ext"...: never over an existing file.
function writeNew(dir, name, bytes) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const full = path.join(dir, i === 0 ? name : `${stem} (${i})${ext}`);
    let fd;
    try {
      fd = fs.openSync(full, 'wx'); // 'wx' = create it, or fail if the name is taken
    } catch (err) {
      if (err.code === 'EEXIST' && i < 999) continue;
      throw err;
    }
    try {
      fs.writeFileSync(fd, bytes);
    } catch (err) {
      fs.closeSync(fd);
      try { fs.unlinkSync(full); } catch {} // our own half-written file: do not leave it behind
      throw err;
    }
    fs.closeSync(fd);
    return full;
  }
}

// ctx = { transport, getState, bridge?, overlay?, timeouts?, notify?, revealFile?, openFile?, downloadsDir? }
function createHandoff(ctx) {
  const { transport, getState } = ctx;
  const bridge = ctx.bridge || { send: () => false, onMessage: () => {}, isConnected: () => false };
  const overlay = { send: () => {}, onAnswer: () => {}, onGhostSettled: () => {}, onFileDropped: () => {}, setDropMode: () => {}, ...ctx.overlay };
  const times = { ...DEFAULT_TIMEOUTS, ...ctx.timeouts };
  const notify = ctx.notify || (() => {}); // a notice in the Control Center: notify("error", text)
  const revealFile = ctx.revealFile || (() => {}); // open Explorer with this file selected
  const openFile = ctx.openFile || (() => 'cannot open files here'); // open a file in its program; returns '' or an error text (maybe as a Promise)
  const downloadsDir = ctx.downloadsDir || path.join(os.homedir(), 'Downloads', 'Odyssync');

  let sidecarDpi = null; // dpiScale from SIDECAR_READY, once it has arrived
  let drag = null; // our one drag in progress: { hwnd, browser, url, title, doc, preview, transfer }
  const waiting = new Map(); // transferId -> our committed transfer, waiting for an answer
  const incoming = new Map(); // transferId -> a transfer coming to us

  // ---------- small helpers ----------

  const selfId = () => getState().self.deviceId;
  const myProfile = () => getState().self.profile;
  const dpi = () => sidecarDpi || myProfile().dpiScale || 1;
  const toDip = (px) => px / dpi();
  const toPx = (dip) => Math.round(dip * dpi());
  const modeOf = (id) => getState().modes[id] || 'collaborative';
  const isMember = (id) => id !== selfId() && getState().members.some((m) => m.deviceId === id);
  const nameOf = (id) => {
    const m = getState().members.find((x) => x.deviceId === id);
    return m ? m.profile.displayName : '';
  };
  const dataUrl = (mime, bytes) => 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64');

  // One event to our own overlay. Every event has type, role, edge, transferId.
  const show = (type, role, edge, transferId, fields) => overlay.send({ type, role, edge, transferId, ...fields });

  // The member next to us on this edge ("RIGHT"), or null. Seating chart AND member list.
  function neighbourOn(edge) {
    const state = getState();
    const id = ((state.neighbors || {})[state.self.deviceId] || {})[edge.toLowerCase()];
    return id && isMember(id) ? id : null;
  }

  // Which of OUR edges faces this sender: from the seating chart, else the
  // opposite of the sender's edge, else LEFT.
  function myEdgeFacing(fromId, senderEdge) {
    const state = getState();
    const mine = (state.neighbors || {})[state.self.deviceId] || {};
    const found = ['left', 'right', 'top', 'bottom'].find((e) => mine[e] === fromId);
    if (found) return found.toUpperCase();
    return OPPOSITE[senderEdge] || 'LEFT';
  }

  // ================= SENDER: our sidecar reports a drag =================

  // The drag left the edge, or was released away from it: tell the receiver, clear our overlay.
  function cancelOutgoing(t) {
    clearTimeout(t.moveTimer);
    transport.sendToPeer(t.target, { type: 'EDGE_DRAG_CANCEL', transferId: t.id });
    show('CANCEL', 'sender', t.edge, t.id);
    if (drag && drag.transfer === t) drag.transfer = null;
  }

  // Forward the stored preview picture to the receiver and show it on our overlay.
  function sendPreview(t, preview) {
    const { mime, width, height, bytes } = preview;
    transport.sendBinaryToPeer(t.target, { type: 'WINDOW_PREVIEW_FRAME', transferId: t.id, mime, width, height }, bytes);
    show('PREVIEW', 'sender', t.edge, t.id, { imageUrl: dataUrl(mime, bytes) });
  }

  // Send the newest move, but at most once per 16 ms and not while the line is
  // backed up. A move that has to wait is sent later by one timer, and a newer
  // move that arrives meanwhile simply replaces it (t.lastMove is always the newest).
  function forwardMove(t) {
    if (t.moveTimer) return; // a send is already booked; it will take the newest move
    const wait = t.lastSentAt + MOVE_MS - Date.now();
    const backedUp = transport.bufferedAmount(t.target) > MAX_BUFFERED;
    if (wait > 0 || backedUp) {
      t.moveTimer = setTimeout(() => { t.moveTimer = null; forwardMove(t); }, wait > 0 ? wait : MOVE_MS);
      return;
    }
    t.lastSentAt = Date.now();
    transport.sendToPeer(t.target, { type: 'EDGE_DRAG_MOVE', transferId: t.id, ...t.lastMove });
  }

  function onDragStart(msg) {
    if (drag && drag.transfer) cancelOutgoing(drag.transfer); // the old drag never ended
    drag = null;
    // doc: the dragged window shows a local file, so the file itself travels: { path, editor }.
    // editor: "code.exe" or "cursor.exe" when the window is a code editor, else null.
    let doc = null;
    if (msg.kind === 'document') {
      if (msg.error) { drag = { error: String(msg.error), hwnd: msg.hwnd }; return; }
      if (typeof msg.path !== 'string' || !msg.path) return; // a document window with no saved file: ignore
      doc = { path: msg.path, editor: EDITORS.has(msg.app) ? msg.app : null,
        app: DOCUMENT_APPS.has(msg.app) ? msg.app : null, keepSource: msg.keepSource === true };
    } else {
      if (msg.tabCount !== 1 || !msg.url) return; // several tabs, or no URL: ignore the whole drag (E4.9)
      if (/^file:/i.test(msg.url)) {
        // A local file open in the browser (a PDF): the URL is useless on the other laptop, send the file.
        try { doc = { path: url.fileURLToPath(msg.url, { windows: true }) }; } catch { return; } // a broken file URL: ignore
      }
    }
    drag = { hwnd: msg.hwnd, browser: msg.browser, url: msg.url, title: msg.title, doc, preview: null, transfer: null };
  }

  function onPreview(header, bytes) {
    if (!drag || drag.hwnd !== header.hwnd || drag.error || !bytes) return;
    drag.preview = { mime: header.mime, width: toDip(header.width), height: toDip(header.height), bytes };
    if (drag.transfer) sendPreview(drag.transfer, drag.preview);
  }

  function onDragMove(msg) {
    if (!drag || drag.hwnd !== msg.hwnd || drag.error) return;
    const edge = msg.edge || null;
    const target = edge ? neighbourOn(edge) : null;
    let t = drag.transfer;
    // Left the edge, moved to another edge, or the neighbour changed: cancel (rule 2).
    if (t && (t.edge !== edge || t.target !== target)) { cancelOutgoing(t); t = null; }
    if (!target) return; // no edge, or no neighbour on it: nothing at all (E4.8)
    if (!t) {
      // Rule 1: entering an edge with a neighbour starts a new transfer.
      const { hwnd, url: tabUrl, title, browser, doc } = drag;
      t = { id: crypto.randomUUID(), target, edge, hwnd, url: tabUrl, title, browser, doc, lastMove: null, lastSentAt: 0, moveTimer: null, timer: null };
      drag.transfer = t;
      if (drag.preview) sendPreview(t, drag.preview);
    }
    t.lastMove = {
      edge,
      protrusionPx: toDip(msg.protrusionPx),
      centerRatio: msg.centerRatio, // a 0..1 ratio: never converted
      width: toDip(msg.width),
      height: toDip(msg.height),
    };
    forwardMove(t);
    const { protrusionPx, centerRatio, width, height } = t.lastMove;
    show('DRAG_MOVE', 'sender', edge, t.id, { protrusionPx, centerRatio, width, height, mode: modeOf(target) });
  }

  function onDragEnd(msg) {
    if (!drag || drag.hwnd !== msg.hwnd) return;
    if (drag.error) {
      const error = drag.error;
      drag = null;
      if (msg.cursorAtEdge && msg.edge && neighbourOn(msg.edge)) notify('error', error);
      return;
    }
    const t = drag.transfer;
    drag = null;
    if (!t) return;
    clearTimeout(t.moveTimer);
    if (!(msg.cursorAtEdge === true && msg.edge === t.edge)) return cancelOutgoing(t); // rule 2
    const receiverMode = modeOf(t.target);
    if (receiverMode === 'focus') {
      // Rule 3: the window bounces back, and the receiver only hears a cancel.
      bridge.send({ type: 'BOUNCE_WINDOW', hwnd: t.hwnd, edge: t.edge });
      transport.sendToPeer(t.target, { type: 'EDGE_DRAG_CANCEL', transferId: t.id });
      show('BOUNCE', 'sender', t.edge, t.id);
      return;
    }
    if (t.doc) return commitDocument(t, receiverMode);
    // Rule 4: hide (not close) our window and ask the receiver to open the tab.
    const { centerRatio, width, height } = t.lastMove;
    bridge.send({ type: 'HIDE_WINDOW', hwnd: t.hwnd });
    transport.sendToPeer(t.target, {
      type: 'TRANSFER_COMMIT', transferId: t.id, kind: 'tab', edge: t.edge, centerRatio, width, height,
      url: t.url, title: t.title, browser: t.browser, direct: false,
    });
    show('COMMIT', 'sender', t.edge, t.id, {
      kind: 'tab', title: t.title, url: t.url, filename: null, size: null,
      fromName: myProfile().displayName, mode: modeOf(selfId()), direct: false,
    });
    waiting.set(t.id, t);
    // The return-the-tab timer: no answer in time -> the window comes back.
    const ms = receiverMode === 'approval' ? times.replyApproval : times.reply;
    t.timer = setTimeout(() => finishOutgoing(t, 'FAILED'), ms);
  }

  // Rule 4 for a document: check and read the file BEFORE hiding the window,
  // then hide it and send the file (TRANSFER_COMMIT + FILE_PAYLOAD) with open: true.
  // A code editor window is not hidden: it slides back (it usually holds a whole
  // project) and only the file goes, with the editor's name.
  function commitDocument(t, receiverMode) {
    let stat;
    try { stat = fs.statSync(t.doc.path); } catch { cancelOutgoing(t); return notify('error', 'Could not read that file'); }
    if (!stat.isFile()) { cancelOutgoing(t); return notify('error', 'Folders cannot be sent. Zip the folder first.'); }
    if (stat.size > MAX_FILE) { cancelOutgoing(t); return notify('error', 'File is too large (max 50 MB)'); }
    let bytes;
    try { bytes = fs.readFileSync(t.doc.path); } catch { cancelOutgoing(t); return notify('error', 'Could not read that file'); }
    if (bytes.length > MAX_FILE) { cancelOutgoing(t); return notify('error', 'File is too large (max 50 MB)'); } // it grew meanwhile
    const filename = path.win32.basename(t.doc.path); // a Windows path (also splits at "/")
    const size = bytes.length;
    const { centerRatio, width, height } = t.lastMove;
    const editor = t.doc.editor;
    const keepSource = editor || t.doc.keepSource;
    if (keepSource) bridge.send({ type: 'BOUNCE_WINDOW', hwnd: t.hwnd, edge: t.edge });
    else bridge.send({ type: 'HIDE_WINDOW', hwnd: t.hwnd });
    // Register before sending: a quick peer can acknowledge synchronously.
    waiting.set(t.id, t);
    const ms = receiverMode === 'approval' ? times.fileReplyApproval : times.fileReply;
    t.timer = setTimeout(() => finishOutgoing(t, 'FAILED'), ms);
    show('COMMIT', 'sender', t.edge, t.id, {
      kind: 'tab', title: filename, url: 'file:///' + encodeURIComponent(filename), filename, size,
      fromName: myProfile().displayName, mode: modeOf(selfId()), direct: false,
    });
    const sent = transport.sendToPeer(t.target, {
      type: 'TRANSFER_COMMIT', transferId: t.id, kind: 'file', open: true, ...(t.browser ? { browser: t.browser } : {}), title: t.title,
      edge: t.edge, centerRatio, width, height, filename, size, direct: false, ...(t.doc.app ? { app: t.doc.app } : {}),
    });
    if (!sent) {
      // It never left: bring the window back now instead of after the long wait (an editor's never went away).
      clearTimeout(t.timer);
      waiting.delete(t.id);
      if (!keepSource) bridge.send({ type: 'SHOW_WINDOW', hwnd: t.hwnd });
      cancelOutgoing(t);
      return notify('error', 'Could not reach that laptop');
    }
    if (!waiting.has(t.id)) return; // receiver immediately refused the commit
    if (!transport.sendBinaryToPeer(t.target, { type: 'FILE_PAYLOAD', transferId: t.id, filename, mimeType: 'application/octet-stream', size }, bytes)) {
      finishOutgoing(t, 'FAILED');
      transport.sendToPeer(t.target, { type: 'EDGE_DRAG_CANCEL', transferId: t.id });
    }
  }

  // A waiting transfer is over: close our window (accepted) or bring it back.
  // A dropped file has no window, and an editor's window stayed. A file or document that did not arrive gets a notice.
  function finishOutgoing(t, result) {
    clearTimeout(t.timer);
    waiting.delete(t.id);
    if (!t.file && !(t.doc && (t.doc.editor || t.doc.keepSource))) bridge.send({ type: result === 'PLACED' ? 'CLOSE_WINDOW' : 'SHOW_WINDOW', hwnd: t.hwnd });
    if ((t.file || t.doc) && result === 'FAILED') notify('error', 'File was not delivered');
    show(result, 'sender', t.edge, t.id);
  }

  // An answer from the receiver: only from that receiver, only while we still wait.
  function onReply(msg) {
    const t = waiting.get(msg.transferId);
    if (!t || msg.fromId !== t.target) return;
    if (msg.type === 'TRANSFER_ACCEPTED') finishOutgoing(t, 'PLACED'); // rule 5
    else if (msg.type === 'TRANSFER_REJECTED') finishOutgoing(t, 'REJECTED'); // rule 6
    else finishOutgoing(t, 'FAILED'); // rule 6
  }

  // ================= SENDER: a file dropped on our overlay =================

  let dropEdge = null; // the edge whose drop strip is showing, or null
  let dropEndTimer = null; // the short wait before the strip goes away
  let dropStartTimer = null; // the short wait before the strip shows

  // Show the drop strip on this edge and let the overlay catch the drop; null hides it.
  function setDropEdge(edge) {
    clearTimeout(dropEndTimer);
    dropEndTimer = null;
    clearTimeout(dropStartTimer);
    dropStartTimer = null;
    if (dropEdge === edge) return;
    if (dropEdge) overlay.send({ type: 'FILE_DRAG', role: 'sender', edge: dropEdge, active: false });
    dropEdge = edge;
    overlay.setDropMode(!!edge);
    if (edge) overlay.send({ type: 'FILE_DRAG', role: 'sender', edge, active: true });
  }

  // Our sidecar: a file is (active) or is no longer dragged near an edge.
  function onFileDrag(msg) {
    if (msg.active) {
      const edge = typeof msg.edge === 'string' && neighbourOn(msg.edge) ? msg.edge : null;
      if (!edge) return;
      if (dropEdge) return setDropEdge(edge); // a strip is already showing: follow the drag (also cancels a pending end)
      // Not showing yet: wait a moment first, so a plain click near the edge never shows the strip.
      clearTimeout(dropStartTimer);
      dropStartTimer = setTimeout(() => { if (neighbourOn(edge)) setDropEdge(edge); }, DROP_START_MS);
      return;
    }
    clearTimeout(dropStartTimer); // it ended before the wait was over: it was a click
    dropStartTimer = null;
    if (dropEdge && !dropEndTimer) dropEndTimer = setTimeout(() => setDropEdge(null), DROP_END_MS);
  }

  // The overlay's drop strip got a file: check it, then send it (TRANSFER_COMMIT + FILE_PAYLOAD).
  function sendFile(edge, filePath, count) {
    setDropEdge(null); // the drag is over
    if (count > 1) return notify('error', 'Drop one file at a time');
    const target = typeof edge === 'string' ? neighbourOn(edge) : null;
    if (!target) return;
    let stat;
    try { stat = fs.statSync(filePath); } catch { return notify('error', 'Could not read that file'); }
    if (!stat.isFile()) return notify('error', 'Folders cannot be sent. Zip the folder first.');
    if (stat.size > MAX_FILE) return notify('error', 'File is too large (max 50 MB)');
    const id = crypto.randomUUID();
    const filename = path.basename(filePath);
    const receiverMode = modeOf(target);
    // Rule 3: the receiver is in focus: the file card bounces back and nothing is sent.
    if (receiverMode === 'focus') return show('BOUNCE', 'sender', edge, id, { kind: 'file', filename, size: stat.size });
    let bytes;
    try { bytes = fs.readFileSync(filePath); } catch { return notify('error', 'Could not read that file'); }
    if (bytes.length > MAX_FILE) return notify('error', 'File is too large (max 50 MB)'); // it grew meanwhile
    const size = bytes.length;
    const sent = transport.sendToPeer(target, {
      type: 'TRANSFER_COMMIT', transferId: id, kind: 'file', edge, centerRatio: 0.5, width: 320, height: 200, filename, size, direct: false,
    });
    if (!sent) return notify('error', 'Could not reach that laptop');
    transport.sendBinaryToPeer(target, { type: 'FILE_PAYLOAD', transferId: id, filename, mimeType: 'application/octet-stream', size }, bytes);
    show('COMMIT', 'sender', edge, id, {
      kind: 'file', title: null, url: null, filename, size,
      fromName: myProfile().displayName, mode: modeOf(selfId()), direct: false,
    });
    const t = { id, target, edge, file: true, timer: null };
    waiting.set(id, t);
    const ms = receiverMode === 'approval' ? times.fileReplyApproval : times.fileReply;
    t.timer = setTimeout(() => finishOutgoing(t, 'FAILED'), ms);
  }

  overlay.onFileDropped((edge, filePath, count) => sendFile(edge, filePath, count));

  // ================= RECEIVER: another laptop sends to us =================

  // Our record of one incoming transfer (made on its first message).
  // stage: 'drag' (ghost following) -> 'approval' -> 'ghost' -> 'opening'.
  function incomingFor(id, fromId, senderEdge) {
    let r = incoming.get(id);
    if (!r) {
      r = { id, from: fromId, edge: myEdgeFacing(fromId, senderEdge), stage: 'drag', commit: null, rect: null, timer: null };
      incoming.set(id, r);
    }
    return r;
  }

  const reply = (r, fields) => transport.sendToPeer(r.from, { transferId: r.id, ...fields });

  // This incoming transfer is over: clear its timers, drop a file's bytes and forget it.
  function forget(r) {
    clearTimeout(r.timer);
    clearTimeout(r.payloadTimer);
    r.bytes = null;
    incoming.delete(r.id);
  }

  // End an incoming transfer with an overlay event and an answer to the sender.
  function endIncoming(r, overlayType, answer) {
    forget(r);
    show(overlayType, 'receiver', r.edge, r.id);
    reply(r, answer);
  }

  // Our screen size in DIPs, and a box clamped to stay fully on it.
  function clampRect({ x, y, width, height }) {
    const { screenWidth: W, screenHeight: H } = myProfile();
    const w = Math.min(width, W);
    const h = Math.min(height, H);
    return { x: Math.min(Math.max(x, 0), W - w), y: Math.min(Math.max(y, 0), H - h), width: w, height: h };
  }

  // No ghostSettled from the overlay: flush against our edge, centred at centerRatio along it.
  function computedRect(r) {
    const { screenWidth: W, screenHeight: H } = myProfile();
    const { width, height, centerRatio } = r.commit;
    const w = Math.min(width, W);
    const h = Math.min(height, H);
    const along = (size, len) => centerRatio * len - size / 2;
    if (r.edge === 'LEFT') return clampRect({ x: 0, y: along(h, H), width: w, height: h });
    if (r.edge === 'RIGHT') return clampRect({ x: W - w, y: along(h, H), width: w, height: h });
    if (r.edge === 'TOP') return clampRect({ x: along(w, W), y: 0, width: w, height: h });
    return clampRect({ x: along(w, W), y: H - h, width: w, height: h });
  }

  // Wait (up to 0.5 s) for the overlay to say where the ghost ended, then open the tab.
  function waitForGhost(r) {
    if (r.rect) return openTab(r); // it already arrived
    r.stage = 'ghost';
    r.timer = setTimeout(() => openTab(r), times.ghost);
  }

  // Ask our sidecar to open the URL (or, for a saved document, the file) at the
  // ghost's spot (physical pixels).
  function openTab(r) {
    clearTimeout(r.timer);
    const rect = clampRect(r.rect || computedRect(r));
    const box = { x: toPx(rect.x), y: toPx(rect.y), width: toPx(rect.width), height: toPx(rect.height) };
    const c = r.commit;
    let cmd;
    if (!r.saved) cmd = { type: 'OPEN_URL', transferId: r.id, url: c.url, browser: c.browser, ...box }; // a tab
    else if (r.app) cmd = { type: 'OPEN_FILE', transferId: r.id, path: r.saved, ...box, app: r.app }; // the same supported application
    else if (c.browser) cmd = { type: 'OPEN_URL', transferId: r.id, url: url.pathToFileURL(r.saved).href, browser: c.browser, ...box }; // it was open in a browser
    else cmd = { type: 'OPEN_FILE', transferId: r.id, path: r.saved, ...box }; // its own program (Notepad, Word...)
    if (r.saved) cmd.expiresAt = Date.now() + times.documentOpen;
    r.stage = 'opening';
    r.timer = setTimeout(() => openFailed(r, 'timeout'), r.saved ? times.documentOpen + 100 : times.open);
    if (!bridge.send(cmd)) return openFailed(r, 'no sidecar');
  }

  // Opening failed: retain/reveal the received bytes, but do not tell the sender
  // to close its source as though a document window had opened successfully.
  function openFailed(r, error) {
    if (r.saved) {
      try { revealFile(r.saved); } catch {}
      notify('error', 'The file arrived in Downloads/Odyssync, but could not be opened: ' + error);
    }
    endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error });
  }

  function onCommit(msg) {
    const hadGhost = incoming.has(msg.transferId);
    const r = incomingFor(msg.transferId, msg.fromId, msg.edge);
    if (r.commit) return; // the same commit twice: already handled
    r.commit = msg;
    const myMode = modeOf(selfId());
    if (myMode === 'focus') {
      // Receiver rule 3, the safety net: the sender should not have sent.
      forget(r);
      if (hadGhost) show('CANCEL', 'receiver', r.edge, r.id);
      return reply(r, { type: 'TRANSFER_REJECTED', reason: 'focus' });
    }
    if (msg.kind === 'file') return onFileCommit(r, msg, myMode); // a file needs no sidecar
    if (msg.kind !== 'tab') {
      forget(r);
      return reply(r, { type: 'TRANSFER_FAILED', error: 'unsupported' });
    }
    if (!bridge.isConnected()) {
      // Nobody here can open a window: say so at once, so the sender gets its window back now.
      return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'no sidecar' });
    }
    show('COMMIT', 'receiver', r.edge, r.id, {
      kind: msg.kind, title: msg.title, url: msg.url, filename: msg.filename || null, size: msg.size || null,
      fromName: nameOf(msg.fromId), mode: myMode, direct: !!msg.direct,
    });
    if (myMode === 'approval') {
      // Receiver rule 2: the overlay docks the card; wait for Accept or Reject.
      r.stage = 'approval';
      r.timer = setTimeout(() => endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'timeout' }), times.approval);
      return;
    }
    waitForGhost(r); // receiver rule 1: collaborative
  }

  // A file is coming; its bytes follow in FILE_PAYLOAD and must arrive within
  // filePayload ms of this commit. stage: 'file-approval' (waiting for Accept) or
  // 'file' (save as soon as the bytes are here).
  function onFileCommit(r, msg, myMode) {
    const { filename, size } = msg;
    if (typeof filename !== 'string' || !Number.isInteger(size) || size < 0 || size > MAX_FILE) {
      forget(r);
      return reply(r, { type: 'TRANSFER_FAILED', error: 'invalid' });
    }
    // Only supported app names can select a launcher.
    r.editor = msg.open === true && EDITORS.has(msg.app) ? msg.app : null;
    r.app = msg.open === true && DOCUMENT_APPS.has(msg.app) ? msg.app : null;
    // A document to open keeps the sliding picture: for the overlay it looks like a tab.
    const card = msg.open === true
      ? { kind: 'tab', title: filename, url: 'file:///' + encodeURIComponent(filename) }
      : { kind: 'file', title: null, url: null };
    show('COMMIT', 'receiver', r.edge, r.id, {
      ...card, filename, size,
      fromName: nameOf(msg.fromId), mode: myMode, direct: !!msg.direct,
    });
    r.payloadTimer = setTimeout(() => endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'timeout' }), times.filePayload);
    if (myMode === 'approval') {
      r.stage = 'file-approval';
      r.timer = setTimeout(() => endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'timeout' }), times.approval);
      return;
    }
    r.stage = 'file';
  }

  // The file's bytes arrived (once, from its sender).
  function onFileBytes(r, bytes) {
    clearTimeout(r.payloadTimer);
    if (bytes.length !== r.commit.size) return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'size mismatch' });
    r.bytes = bytes;
    if (r.stage === 'file') saveFile(r);
  }

  // Save into Downloads\Odyssync under a new name, then show it in Explorer
  // (a document: open it instead), tell the sender.
  function saveFile(r) {
    let full;
    try {
      fs.mkdirSync(downloadsDir, { recursive: true });
      full = writeNew(downloadsDir, safeName(r.commit.filename), r.bytes);
    } catch {
      return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'could not save' });
    }
    r.saved = full;
    if (r.commit.open === true && r.app && !bridge.isConnected()) return openFailed(r, 'no sidecar');
    // Only ordinary documents open by themselves; text editors display any file.
    const editorHere = (r.editor || r.app === 'notepad.exe') && bridge.isConnected();
    if (r.commit.open === true && (editorHere || OPENABLE.has(path.extname(full).toLowerCase()))) return openSaved(r, full);
    if (r.commit.open === true) return openFailed(r, 'this file type cannot be opened automatically');
    delivered(r, full);
  }

  // The file is saved: show it in Explorer and tell the sender it arrived.
  function delivered(r, full) {
    try { revealFile(full); } catch (err) { console.log('[handoff] could not show the file: ' + err.message); }
    endIncoming(r, 'PLACED', { type: 'TRANSFER_ACCEPTED' });
  }

  // Open a saved document: with our sidecar at the ghost's spot (like a tab),
  // else (no sidecar, e.g. a Mac) with the app's openFile. The file stays saved either way.
  function openSaved(r, full) {
    r.saved = full;
    if (bridge.isConnected()) return waitForGhost(r);
    r.stage = 'opening-here';
    const failed = (error) => { if (incoming.get(r.id) === r) endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error }); };
    Promise.resolve()
      .then(() => openFile(full))
      .then((err) => {
        if (typeof err === 'string' && err !== '') return failed(err);
        if (incoming.get(r.id) === r) endIncoming(r, 'PLACED', { type: 'TRANSFER_ACCEPTED' });
      }, (err) => failed(String((err && err.message) || err)));
  }

  // The Approval card's answer.
  overlay.onAnswer((transferId, accepted) => {
    const r = incoming.get(transferId);
    if (!r || (r.stage !== 'approval' && r.stage !== 'file-approval')) return;
    clearTimeout(r.timer);
    if (!accepted) return endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'rejected' });
    if (r.stage === 'approval') return waitForGhost(r);
    r.stage = 'file'; // a file: save now if the bytes are already here, else when they come
    if (r.bytes) saveFile(r);
  });

  // Where the ghost ended (DIPs). Kept for later if we are not ready for it yet.
  overlay.onGhostSettled((transferId, rect) => {
    const r = incoming.get(transferId);
    if (!r || !rect) return;
    r.rect = rect;
    if (r.stage === 'ghost') openTab(r);
  });

  // A handoff message from another laptop (room.js passes on everything it does not handle).
  function onPeerMessage(msg, payload) {
    if (!isMember(msg.fromId)) return; // only from members of our room
    const r = incoming.get(msg.transferId);
    // Focus mode: nothing may appear on our screen (E5.3), so the picture and the moves are dropped.
    const quiet = modeOf(selfId()) === 'focus';
    switch (msg.type) {
      case 'WINDOW_PREVIEW_FRAME': {
        if (!payload || quiet) return;
        const rec = incomingFor(msg.transferId, msg.fromId, null);
        return show('PREVIEW', 'receiver', rec.edge, rec.id, { imageUrl: dataUrl(msg.mime, payload) });
      }
      case 'EDGE_DRAG_MOVE': {
        if (quiet) return;
        const rec = incomingFor(msg.transferId, msg.fromId, msg.edge);
        if (rec.commit) return; // too late, already committed
        rec.edge = OPPOSITE[msg.edge] || rec.edge;
        const { screenWidth: W, screenHeight: H } = myProfile();
        return show('DRAG_MOVE', 'receiver', rec.edge, rec.id, {
          protrusionPx: msg.protrusionPx, centerRatio: msg.centerRatio,
          width: Math.min(msg.width, W), height: Math.min(msg.height, H), mode: modeOf(selfId()),
        });
      }
      case 'EDGE_DRAG_CANCEL':
        if (!r || r.from !== msg.fromId || r.commit) return;
        forget(r);
        return show('CANCEL', 'receiver', r.edge, r.id);
      case 'TRANSFER_COMMIT':
        if (r && r.from !== msg.fromId) return;
        return onCommit(msg);
      case 'FILE_PAYLOAD':
        if (!r || r.from !== msg.fromId || !r.commit || r.commit.kind !== 'file' || r.bytes || !payload) return;
        return onFileBytes(r, payload);
      case 'TRANSFER_ACCEPTED':
      case 'TRANSFER_REJECTED':
      case 'TRANSFER_FAILED':
        return onReply(msg);
      default:
    }
  }

  // ================= our sidecar's messages =================

  bridge.onMessage((msg, payload) => {
    switch (msg.type) {
      case 'SIDECAR_READY':
        if (msg.dpiScale > 0) sidecarDpi = msg.dpiScale;
        return;
      case 'LOCAL_DRAG_START': return onDragStart(msg);
      case 'LOCAL_WINDOW_PREVIEW': return onPreview(msg, payload);
      case 'LOCAL_DRAG_MOVE': return onDragMove(msg);
      case 'LOCAL_DRAG_END': return onDragEnd(msg);
      case 'LOCAL_FILE_DRAG': return onFileDrag(msg);
      case 'WINDOW_PLACED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') endIncoming(r, 'PLACED', { type: 'TRANSFER_ACCEPTED' });
        return;
      }
      case 'OPEN_FAILED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') openFailed(r, msg.error);
        return;
      }
      default:
    }
  });

  // ================= someone left =================

  // Called after every room change. Anything tied to a laptop that is no longer
  // a member (or to us, after we left the room) ends now; no timer is left behind.
  function roomChanged() {
    if (dropEdge && !neighbourOn(dropEdge)) setDropEdge(null); // left the room, or the neighbour went
    const t = drag && drag.transfer;
    if (t && !isMember(t.target)) {
      clearTimeout(t.moveTimer);
      drag.transfer = null;
      show('CANCEL', 'sender', t.edge, t.id);
    }
    for (const w of [...waiting.values()]) {
      if (!isMember(w.target)) finishOutgoing(w, 'FAILED'); // the window comes back at once
    }
    for (const r of [...incoming.values()]) {
      if (isMember(r.from)) continue;
      forget(r);
      show('CANCEL', 'receiver', r.edge, r.id);
    }
  }

  return { onPeerMessage, roomChanged };
}

module.exports = { createHandoff };
