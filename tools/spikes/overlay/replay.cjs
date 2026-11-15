// Local synthetic fixture only; does not send network or sidecar messages.
exports.run = function (contents) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260"><rect width="420" height="260" fill="#07172f"/><rect x="24" y="24" width="372" height="40" rx="8" fill="#155cf4"/><text x="24" y="120" fill="#f2f6ff" font-size="24">Odyssync replay preview</text></svg>';
  const imageUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const timers = [];
  const later = (ms, event) => timers.push(setTimeout(() => {
    if (!contents.isDestroyed()) contents.send('overlay-replay:event', event);
  }, ms));
  ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].forEach((edge, index) => {
    const base = { transferId: `replay-${edge}`, edge, role: 'receiver', width: 420, height: 260, centerRatio: 0.3 + index * 0.12, mode: 'collaborative' };
    const start = 1000 + index * 700;
    later(start, { ...base, type: 'PREVIEW', imageUrl });
    for (let step = 0; step <= 60; step++) later(start + step * 16, { ...base, type: 'DRAG_MOVE', protrusionPx: step * 3 });
    later(start + 1100, { ...base, type: index === 0 ? 'CANCEL' : 'COMMIT' });
    if (index > 0) later(start + 2400, { ...base, type: index === 2 ? 'FAILED' : 'PLACED' });
  });
  const sender = { transferId: 'replay-sender', edge: 'RIGHT', role: 'sender', width: 420, height: 260, centerRatio: 0.5, protrusionPx: 420 };
  later(5500, { ...sender, type: 'PREVIEW', imageUrl });
  later(5600, { ...sender, type: 'COMMIT' });
  later(6100, { ...sender, type: 'REJECTED' });
  // Every renderer edge, role, and mode; centerRatio sweeps end to end.
  ['sender', 'receiver'].forEach((role, roleIndex) => {
    ['collaborative', 'approval', 'focus'].forEach((mode, modeIndex) => {
      ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].forEach(edge => {
        const base = { transferId: `bezel-${role}-${mode}-${edge}`, role, mode, edge, width: 200, height: 120, protrusionPx: 30 };
        const start = 7500 + (roleIndex * 3 + modeIndex) * 1800;
        for (let step = 0; step <= 60; step++) later(start + step * 24, { ...base, type: 'DRAG_MOVE', centerRatio: step / 60 });
        later(start + 1600, { ...base, type: 'CANCEL' });
      });
    });
  });
  contents.once('destroyed', () => timers.forEach(clearTimeout));
  ['listening', 'thinking', 'speaking', 'idle'].forEach((state, index) => {
    later(1000 + index * 1800, { type: 'VOICE', state });
  });
  const direct = { type: 'COMMIT', direct: true, role: 'receiver', mode: 'collaborative', width: 360, height: 220, centerRatio: .5 };
  later(6500, { ...direct, transferId: 'direct-tab', edge: 'TOP', title: 'Direct arrival without preview', url: 'https://example.com' });
  later(7200, { type: 'PLACED', transferId: 'direct-tab', role: 'receiver' });
  later(6500, { ...direct, transferId: 'direct-file', edge: 'BOTTOM', kind: 'file', filename: 'Replay document.pdf', size: 123456 });
  later(7200, { type: 'PLACED', transferId: 'direct-file', role: 'receiver' });
  ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'].forEach((edge, index) => {
    const base = { transferId: `bounce-${edge}`, edge, role: 'sender', width: 340, height: 220, centerRatio: .5, protrusionPx: 90 };
    later(19000 + index * 700, { ...base, type: 'PREVIEW', imageUrl });
    later(19100 + index * 700, { ...base, type: 'BOUNCE' });
  });
  ['LEFT', 'RIGHT'].forEach((edge, index) => {
    const base = { transferId: `approval-${edge}`, edge, role: 'receiver', mode: 'approval', width: 420, height: 260, centerRatio: .5,
      fromName: 'Replay device', title: 'Approval replay — no real tab will open', url: 'https://example.com/approval-replay' };
    later(22500 + index * 500, { ...base, type: 'PREVIEW', imageUrl });
    later(22600 + index * 500, { ...base, type: 'COMMIT' });
    later(52600 + index * 500, { ...base, type: 'REJECTED' });
  });
};
