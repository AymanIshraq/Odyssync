(function (root) {
  const warm = /^(ZIP|RAR|7Z|EXE|FILE)$/i;
  const kindWord = item => item.kind === 'tab' ? 'tab' : 'file';

  // Several parts of the overlay may want clicks at once (Approval card, send menu).
  // Main keeps one flag, so the overlay only tells main when the combined answer changes.
  function combineInteractive(api) {
    const wants = {}; let on = false;
    return name => value => {
      wants[name] = !!value;
      const next = Object.values(wants).some(Boolean);
      if (next !== on) { on = next; api.setInteractive(on); }
    };
  }

  function createSendMenu({ document, api, setInteractive, timers = globalThis }) {
    let menu = null, toast = null, toastTimer = null;
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const stack = el('div', 'sendmenu-stack');
    let attached = false;
    const attach = () => { if (!attached) { document.body.append(stack); attached = true; } };

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu) finish(null); });

    function close() {
      if (!menu) return;
      menu.card.remove(); menu.backdrop.remove(); menu = null;
      setInteractive(false);
    }
    function finish(answer) {
      if (!menu) return;
      const id = menu.requestId; close();
      api.sendMenuAnswer(id, answer);
    }

    function open(e) {
      if (menu) finish(null); // a newer menu replaces an unanswered one
      const items = Array.isArray(e.items) ? e.items : null;
      const people = Array.isArray(e.people) ? e.people : null;
      const target = typeof e.targetDeviceId === 'string' ? e.targetDeviceId : null;
      const askPerson = !!people && !target;
      const ticked = new Set(); let person = null;

      const backdrop = el('div', 'sendmenu-backdrop');
      backdrop.addEventListener('click', () => finish(null));
      const card = el('section', 'sendmenu-card');
      card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', e.title || 'Select to send');
      const head = el('div', 'sendmenu-head');
      const closeBtn = el('button', 'sendmenu-close', '✕');
      closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.addEventListener('click', () => finish(null));
      head.append(el('h2', 'sendmenu-title', e.title || 'Select to send'), closeBtn);
      card.append(head);

      const rows = [];
      if (items) {
        const list = el('div', 'sendmenu-list'); list.setAttribute('role', 'group');
        items.forEach((item, i) => {
          const row = el('button', 'sendmenu-row'); row.type = 'button';
          row.setAttribute('role', 'checkbox'); row.setAttribute('aria-checked', 'false');
          const text = el('span', 'sendmenu-text');
          text.append(el('b', '', String(item.name ?? '')), el('small', '', String(item.detail ?? '')));
          row.append(
            el('span', 'sendmenu-number', String(item.number ?? i + 1)),
            el('span', 'sendmenu-badge' + (warm.test(item.badge || '') ? ' warm' : ''), String(item.badge ?? '')),
            text, el('span', 'sendmenu-check', '✓'));
          row.lastChild.setAttribute('aria-hidden', 'true');
          row.addEventListener('click', () => { if (ticked.has(i)) ticked.delete(i); else ticked.add(i); paint(); });
          rows.push(row); list.append(row);
        });
        card.append(list);
      }

      const pills = [];
      if (askPerson) {
        const row = el('div', 'sendmenu-people'); row.setAttribute('role', 'radiogroup');
        if (items) row.append(el('span', 'sendmenu-people-label', 'Send to'));
        for (const p of people) {
          const focus = p.mode === 'focus';
          const pill = el('button', 'sendmenu-pill'); pill.type = 'button';
          pill.setAttribute('role', 'radio'); pill.setAttribute('aria-checked', 'false');
          pill.append(el('span', '', String(p.name ?? 'Someone')));
          if (focus) { pill.disabled = true; pill.append(el('small', 'sendmenu-focus', 'Focus')); }
          pill.addEventListener('click', () => {
            if (focus) return;
            if (!items) { finish({ itemIds: null, deviceId: p.deviceId }); return; }
            person = p.deviceId; paint();
          });
          pills.push({ pill, deviceId: p.deviceId }); row.append(pill);
        }
        card.append(row);
      }

      let count = null, sendBtn = null;
      if (items) {
        const footer = el('div', 'sendmenu-footer');
        count = el('span', 'sendmenu-count'); sendBtn = el('button', 'sendmenu-send', 'Send'); sendBtn.type = 'button';
        sendBtn.addEventListener('click', () => {
          if (sendBtn.disabled) return;
          finish({ itemIds: [...ticked].sort((a, b) => a - b).map(i => items[i].id), deviceId: target || person });
        });
        footer.append(count, sendBtn); card.append(footer);
      }

      function paint() {
        rows.forEach((row, i) => row.setAttribute('aria-checked', String(ticked.has(i))));
        pills.forEach(p => p.pill.setAttribute('aria-checked', String(p.deviceId === person)));
        if (!items) return;
        const n = ticked.size, one = n === 1 ? kindWord(items[[...ticked][0]]) : '';
        count.textContent = n === 0 ? 'Nothing selected' : n === 1 ? `1 ${one} selected` : `${n} items selected`;
        sendBtn.textContent = n === 0 ? 'Send' : n === 1 ? `Send ${one}` : `Send ${n} items`;
        sendBtn.disabled = n === 0 || (askPerson && !person);
      }
      paint();

      attach();
      document.body.append(backdrop);
      stack.append(card);
      menu = { requestId: e.requestId, card, backdrop, rows, pills, ticked };
      setInteractive(true);
    }

    function showToast(text) {
      if (toast) toast.remove();
      if (toastTimer) timers.clearTimeout(toastTimer);
      toast = el('div', 'voice-toast', String(text ?? ''));
      toast.setAttribute('role', 'status');
      attach(); stack.prepend ? stack.prepend(toast) : stack.append(toast);
      const mine = toast;
      toastTimer = timers.setTimeout(() => { mine.remove(); if (toast === mine) { toast = null; toastTimer = null; } }, 4000);
    }

    function receive(e) {
      if (e?.type === 'SEND_MENU') open(e);
      else if (e?.type === 'SEND_MENU_CLOSE') { if (menu && (e.requestId == null || e.requestId === menu.requestId)) close(); }
      else if (e?.type === 'VOICE_TOAST') showToast(e.text);
    }
    return { receive, current: () => menu, toast: () => toast };
  }
  if (typeof module !== 'undefined') module.exports = { createSendMenu, combineInteractive };
  else root.OverlaySendMenu = { createSendMenu, combineInteractive };
})(globalThis);
