// Handoff: the tab-handoff state machine (plan/contract.md, "Sender rules" and
// "Receiver rules"). As SENDER it turns this laptop's sidecar drag reports into
// network messages and overlay events; as RECEIVER it turns other laptops'
// messages into overlay events and sidecar commands, and answers the sender.
// Units: the sidecar speaks physical pixels; the network and the overlay use
// DIPs. Network `edge` is always the sender's edge; overlay events get THIS
// screen's edge. No Electron in here, so it can be tested with plain `node`.
const crypto = require('crypto');

const MOVE_MS = 16; // EDGE_DRAG_MOVE at most once per 16 ms
const MAX_BUFFERED = 64 * 1024; // bytes waiting on the socket before we hold moves back
const DEFAULT_TIMEOUTS = {
  reply: 5000, // sender: no answer in 5 s -> window comes back
  replyApproval: 35000, // the same, when the receiver is in approval mode
  approval: 30000, // receiver: no Accept/Reject in 30 s -> rejected
  ghost: 500, // receiver: wait this long for the overlay's ghostSettled (its animation takes about 0.26 s)
  open: 4300, // receiver: wait for the sidecar's answer (it tries for 4 s); ghost + this stays under the sender's 5 s
};
const OPPOSITE = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' };

// ctx = { transport, getState, bridge?, overlay?, timeouts? }
function createHandoff(ctx) {
  const { transport, getState } = ctx;
  const bridge = ctx.bridge || { send: () => false, onMessage: () => {}, isConnected: () => false };
  const overlay = ctx.overlay || { send: () => {}, onAnswer: () => {}, onGhostSettled: () => {} };
  const times = { ...DEFAULT_TIMEOUTS, ...ctx.timeouts };

  let sidecarDpi = null; // dpiScale from SIDECAR_READY, once it has arrived
  let drag = null; // our one drag in progress: { hwnd, browser, url, title, preview, transfer }
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
    if (msg.tabCount !== 1 || !msg.url) return; // several tabs, or no URL: ignore the whole drag (E4.9)
    drag = { hwnd: msg.hwnd, browser: msg.browser, url: msg.url, title: msg.title, preview: null, transfer: null };
  }

  function onPreview(header, bytes) {
    if (!drag || !bytes) return;
    drag.preview = { mime: header.mime, width: toDip(header.width), height: toDip(header.height), bytes };
    if (drag.transfer) sendPreview(drag.transfer, drag.preview);
  }

  function onDragMove(msg) {
    if (!drag) return;
    const edge = msg.edge || null;
    const target = edge ? neighbourOn(edge) : null;
    let t = drag.transfer;
    // Left the edge, moved to another edge, or the neighbour changed: cancel (rule 2).
    if (t && (t.edge !== edge || t.target !== target)) { cancelOutgoing(t); t = null; }
    if (!target) return; // no edge, or no neighbour on it: nothing at all (E4.8)
    if (!t) {
      // Rule 1: entering an edge with a neighbour starts a new transfer.
      const { hwnd, url, title, browser } = drag;
      t = { id: crypto.randomUUID(), target, edge, hwnd, url, title, browser, lastMove: null, lastSentAt: 0, moveTimer: null, timer: null };
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
    if (!drag) return;
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
    // Rule 4: hide (not close) our window and ask the receiver to open the tab.
    const { centerRatio, width, height } = t.lastMove;
    if (!bridge.send({ type: 'HIDE_WINDOW', hwnd: t.hwnd })) return cancelOutgoing(t);
    show('COMMIT', 'sender', t.edge, t.id, {
      kind: 'tab', title: t.title, url: t.url, filename: null, size: null,
      fromName: myProfile().displayName, mode: modeOf(selfId()), direct: false,
    });
    waiting.set(t.id, t);
    // The return-the-tab timer: no answer in time -> the window comes back.
    const ms = receiverMode === 'approval' ? times.replyApproval : times.reply;
    t.timer = setTimeout(() => finishOutgoing(t, 'FAILED'), ms);
    // Register the transfer and timeout before a fast receiver can acknowledge.
    transport.sendToPeer(t.target, {
      type: 'TRANSFER_COMMIT', transferId: t.id, kind: 'tab', edge: t.edge, centerRatio, width, height,
      url: t.url, title: t.title, browser: t.browser, direct: false,
    });
  }

  // A waiting transfer is over: close our window (accepted) or bring it back.
  function finishOutgoing(t, result) {
    clearTimeout(t.timer);
    waiting.delete(t.id);
    bridge.send({ type: result === 'PLACED' ? 'CLOSE_WINDOW' : 'SHOW_WINDOW', hwnd: t.hwnd });
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

  // This incoming transfer is over: clear its timer and forget it.
  function forget(r) {
    clearTimeout(r.timer);
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

  // Ask our sidecar to open the URL at the ghost's spot (physical pixels).
  function openTab(r) {
    clearTimeout(r.timer);
    const rect = clampRect(r.rect || computedRect(r));
    const sent = bridge.send({
      type: 'OPEN_URL', transferId: r.id, url: r.commit.url, browser: r.commit.browser,
      expiresAt: Date.now() + Math.max(1, times.open - 200),
      x: toPx(rect.x), y: toPx(rect.y), width: toPx(rect.width), height: toPx(rect.height),
    });
    if (!sent) return endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'no sidecar' });
    r.stage = 'opening';
    r.timer = setTimeout(() => endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: 'timeout' }), times.open);
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
    if (msg.kind !== 'tab') {
      forget(r); // files come later
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

  // The Approval card's answer.
  overlay.onAnswer((transferId, accepted) => {
    const r = incoming.get(transferId);
    if (!r || r.stage !== 'approval') return;
    clearTimeout(r.timer);
    if (accepted) waitForGhost(r);
    else endIncoming(r, 'REJECTED', { type: 'TRANSFER_REJECTED', reason: 'rejected' });
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
      case 'WINDOW_PLACED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') endIncoming(r, 'PLACED', { type: 'TRANSFER_ACCEPTED' });
        return;
      }
      case 'OPEN_FAILED': {
        const r = incoming.get(msg.transferId);
        if (r && r.stage === 'opening') endIncoming(r, 'FAILED', { type: 'TRANSFER_FAILED', error: msg.error });
        return;
      }
      default:
    }
  });

  // ================= someone left =================

  // Called after every room change. Anything tied to a laptop that is no longer
  // a member (or to us, after we left the room) ends now; no timer is left behind.
  function roomChanged() {
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
