(() => {
  'use strict';
  const api = window.odyssync;
  const app = document.querySelector('#app');
  const message = document.querySelector('#message');
  let state = {}, view = 'launch', name = '', direct = false, busy = false;
  let drag = null, transform = null, operation = 0, dialogKind = null, sending = new Set();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selfId = () => typeof state.self === 'string' ? state.self : state.self?.deviceId;
  const selfName = () => state.self?.profile?.displayName || state.self?.displayName || '';
  const logo = '<span class="logo-symbol" aria-hidden="true"><i></i><i></i></span><strong>odyssync</strong>';
  const laptop = color => `<div class="laptop-art ${color}"><div class="laptop-screen"><span></span><span></span></div><div class="laptop-base"></div></div>`;
  const isPreview = document.body.dataset.preview === 'true';
  let messageTimer = null;
  message.onclick = () => notify('');
  message.style.cursor = 'pointer';
  message.title = 'Click to dismiss';
  function notify(text) {
    clearTimeout(messageTimer);
    message.textContent = text; message.hidden = !text;
    if (text) messageTimer = setTimeout(() => { message.hidden = true; message.textContent = ''; }, 5000);
  }
  function error(text) { const el = document.querySelector('#error'); if (el) el.textContent = text; else notify(text); }
  const joinErrors = {bad_pin:'Wrong PIN. Check it and try again.', no_room:'No room with that number.', full:'The room is full.', unreachable:'Could not reach the room. Check the connection or the IP address.'};
  function setBusy(value) {
    busy = value;
    app.querySelectorAll('button,input').forEach(el => {
      if(value){el.dataset.busyDisabled=String(el.disabled);el.disabled=true;}
      else if('busyDisabled' in el.dataset){el.disabled=el.dataset.busyDisabled==='true';delete el.dataset.busyDisabled;}
    });
    app.setAttribute('aria-busy', String(value));
  }
  async function action(task) {
    if (busy) return;
    const token = operation;
    setBusy(true); error('');
    try { await task(token); }
    catch (e) { if (token === operation) error(e?.message || 'Something went wrong. Please try again.'); }
    finally { if (token === operation) setBusy(false); }
  }
  function launch() { view = 'launch'; direct = false; dialogKind = null; render(); }
  function digits(id, count, label) {
    return `<label id="${id}-label">${label}</label><div class="digit-group" role="group" aria-labelledby="${id}-label">${Array.from({length:count}, (_,i) => `<input class="digit" data-group="${id}" aria-label="${label}, digit ${i+1}" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="off" required>`).join('')}</div>`;
  }
  function header() {
    return `<header class="window-bar"><div class="logo">${logo}</div><span class="header-caption">${view === 'room' ? 'Workspace' : 'Control Center'}</span><button class="theme-toggle" id="theme" aria-label="Use light theme">☼</button></header>`;
  }
  function bindTheme() {
    const button = document.querySelector('#theme');
    const update = () => { const light = document.body.classList.contains('light'); button.textContent = light ? '☾' : '☼'; button.setAttribute('aria-label', light ? 'Use dark theme' : 'Use light theme'); };
    button.onclick = () => {
      document.body.classList.toggle('light'); update();
      try { localStorage.setItem('odyssync.theme', document.body.classList.contains('light') ? 'light' : 'dark'); } catch {}
    };
    update();
  }
  function render() {
    if (view === 'room') { renderRoom(); return; }
    app.innerHTML = `<div class="landing-shell">${header()}<section class="landing-content"><div class="hero-copy"><div class="product-kicker"><span class="accent-dot"></span>Sharing for laptops</div><h1>Your screens.<br>One shared space.</h1><p>Bring your laptops into one workspace.<br>Create a room or join your team.</p><div class="hero-actions"><label for="name">Display name</label><input id="name" maxlength="60" placeholder="Enter your name" value="${esc(name)}"><div class="choices"><button class="choice primary" id="create"><span aria-hidden="true">＋</span> Create a Room</button><button class="choice secondary" id="join"><span aria-hidden="true">♧</span> Join a Room</button></div></div><p class="error" id="error" role="alert"></p><small>${isPreview ? 'Demo workspace. No laptops are connected.' : 'Join with a room number and PIN, or a host IP address.'}</small></div><div class="hero-visual" role="img" aria-label="Three laptop illustrations arranged around connecting rings"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="hero-laptop top">${laptop('blue')}</div><div class="hero-laptop left">${laptop('orange')}</div><div class="hero-laptop right">${laptop('lime')}</div><div class="connection-pulse pulse-one"></div><div class="connection-pulse pulse-two"></div></div></section><footer class="landing-footer"><span>${isPreview ? 'Odyssync demo' : 'Odyssync · Control Center'}</span><span>Your mouse. Your keyboard.</span></footer></div>`;
    bindTheme();
    document.querySelector('#name').oninput = e => name = e.target.value;
    document.querySelector('#create').onclick = () => { if (validName()) openDialog('create'); };
    document.querySelector('#join').onclick = () => { if (validName()) openDialog('join'); };
    if (!api) {
      error('The app connection is unavailable. Open preview.html to try the demo.');
      app.querySelectorAll('#create,#join').forEach(el => el.disabled = true);
    }
  }
  function validName() {
    if (name.trim()) return true;
    error('Enter your display name first.'); document.querySelector('#name')?.focus(); return false;
  }
  function closeDialog() {
    if (busy) return;
    const kind = dialogKind;
    document.querySelector('dialog')?.close();
    document.querySelector('dialog')?.remove();
    const landingError = document.querySelector('.hero-copy .error');
    if (landingError) landingError.id = 'error';
    dialogKind = null; direct = false;
    const opener = {create:'#create',join:'#join',requests:'#requests',permissions:'#permissions'}[kind];
    if (opener) document.querySelector(opener)?.focus();
  }
  function openDialog(kind) {
    dialogKind = kind;
    // Native dialog supplies focus containment and makes the landing page inert.
    document.querySelector('dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'entry-dialog'; dialog.setAttribute('aria-labelledby', 'dialog-title');
    const creating = kind === 'create';
    dialog.innerHTML = `<button class="modal-close" id="back" type="button" aria-label="Close ${kind} form">×</button><div class="logo dialog-logo">${logo}</div><div class="dialog-illustration ${creating ? '' : 'join'}" aria-hidden="true">${creating ? '＋' : '⇥'}</div><h2 id="dialog-title">${creating ? 'Create your workspace' : 'Join a workspace'}</h2><p>${creating ? 'Start a room, then invite your team with its number and PIN.' : `Ask your host for the ${direct ? 'IP address' : 'room number'} and PIN.`}</p><form id="entry-form">${creating ? `<label for="create-name">Display name</label><input class="wide" id="create-name" maxlength="60" value="${esc(name)}" required>` : `${direct ? '<label for="ip">Host IP address</label><input class="wide" id="ip" placeholder="192.168.137.1" required autocomplete="off" spellcheck="false">' : digits('room',6,'Room number')}${digits('pin',4,'Room PIN')}<button class="link" id="direct" type="button">${direct ? 'Use room number instead' : 'Offline / Direct IP'}</button>`}<p class="error" id="dialog-error" role="alert"></p><button class="primary submit-button" type="submit">${creating ? 'Create room' : 'Join room'} <span aria-hidden="true">›</span></button></form>`;
    app.append(dialog);
    // Keep a single active error target while a dialog is open.
    document.querySelector('.hero-copy #error')?.removeAttribute('id');
    dialog.querySelector('#dialog-error').id = 'error';
    dialog.querySelector('#back').onclick = closeDialog;
    dialog.oncancel = e => { e.preventDefault(); closeDialog(); };
    if (!creating) {
      dialog.querySelector('#direct').onclick = () => { direct = !direct; openDialog('join'); };
      dialog.querySelectorAll('.digit').forEach(input => {
        input.oninput = () => { input.value = input.value.replace(/\D/g,'').slice(-1); if (input.value) input.nextElementSibling?.focus(); };
        input.onkeydown = e => {
          if ((e.key === 'Backspace' && !input.value) || e.key === 'ArrowLeft') input.previousElementSibling?.focus();
          if (e.key === 'ArrowRight') input.nextElementSibling?.focus();
        };
        input.onpaste = e => {
          e.preventDefault();
          const value = e.clipboardData.getData('text').replace(/\D/g,'');
          const group = [...dialog.querySelectorAll(`[data-group="${input.dataset.group}"]`)];
          const start = group.indexOf(input);
          value.slice(0,group.length-start).split('').forEach((v,i) => group[start+i].value=v);
          group[Math.min(start+value.length,group.length-1)].focus();
        };
      });
    }
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault();
      if (creating) {
        name = dialog.querySelector('#create-name').value.trim();
        if (!name) { error('Enter your display name first.'); return; }
        action(async token => {
          const result = await api.createRoom(name);
          if (token !== operation) return;
          state = {...state,...result,isHost:true}; view = 'room'; dialogKind = null; render();
        });
      } else {
        const read = group => [...dialog.querySelectorAll(`[data-group="${group}"]`)].map(i=>i.value).join('');
        const payload = {roomNumber:direct ? '' : read('room'), pin:read('pin'), displayName:name.trim()};
        if (direct) payload.directIp = dialog.querySelector('#ip').value.trim();
        action(async token => {
          const result = await api.joinRoom(payload);
          if (token !== operation) return;
          if (!result.ok) { error(joinErrors[result.reason] || result.reason || 'Could not join the room.'); return; }
          view = 'room'; dialogKind = null; render();
        });
      }
    };
    dialog.showModal();
    dialog.querySelector('input')?.focus();
  }
  function renderRoom() {
    const screens = state.screens || [];
    app.innerHTML = `<div class="workspace-window">${header()}<div class="workspace-body"><section class="room-top"><div><span class="eyebrow">Workspace / ${state.isHost ? 'Host' : 'Member'}</span><h1>Your workspace</h1></div><button class="secondary" id="copy">Copy Invite <span aria-hidden="true">⧉</span></button></section><section class="invite"><div><span class="label">Room number</span><strong>${esc(state.roomNumber || '—')}</strong></div><div><span class="label">Room PIN</span><strong>${esc(state.pin || '—')}</strong></div>${state.localIps?.length ? `<div><span class="label">Host IP</span><strong class="ips">${esc(state.localIps.join(', '))}</strong></div>` : ''}</section><section class="canvas-panel"><div class="canvas-heading"><div><h2><span class="section-index">01</span> Workspace devices</h2><p>${state.isHost ? 'Drag over a laptop to swap, or beside it to arrange your desk.' : 'Your host arranges the screens. Changes appear here live.'}</p></div><span class="count">${screens.length} ${screens.length === 1 ? 'screen' : 'screens'}</span></div><div class="canvas" id="canvas" aria-label="Laptop layout"></div><div class="canvas-footer">${state.isHost ? 'Keyboard: focus a laptop, use arrow keys, then Enter to place or swap.' : 'View only · Your host manages this layout.'}</div></section><div class="workspace-exit"><button class="leave-button" id="leave"><span aria-hidden="true">⇥</span> ${state.isHost ? 'End Room' : 'Leave'}</button></div></div><footer class="landing-footer"><span>${isPreview ? 'Demo · No laptops connected' : 'Odyssync · Control Center'}</span><span>${state.isHost ? 'Host controls' : 'Member view'}</span></footer></div>`;
    bindTheme();
    if (state.isHost) {
    const tools = document.createElement('section');
    tools.className = 'manager-tools';
    tools.setAttribute('aria-label','Workspace management');
    tools.innerHTML = `<button class="tool-card" id="requests"><span class="tool-icon blue" aria-hidden="true">${managementIcon('people')}</span><span><strong>Join requests</strong><small>Review who can join your workspace.</small></span><span class="tool-chevron" aria-hidden="true">›</span></button><button class="tool-card" id="permissions"><span class="tool-icon orange" aria-hidden="true">${managementIcon('shield')}</span><span><strong>Sharing permissions</strong><small>Manage who can share content.</small></span><span class="tool-chevron" aria-hidden="true">›</span></button>`;
    document.querySelector('.canvas-panel').before(tools);
    document.querySelector('#requests').onclick = () => openManagement('requests');
    const pendingCount = state.management?.joinRequests?.length || 0;
    if(pendingCount)document.querySelector('#requests strong').textContent += ` (${pendingCount})`;
    document.querySelector('#permissions').onclick = () => openManagement('permissions');
    }
    const modeSection = document.createElement('section');
    modeSection.className = 'mode-section';
    const currentMode = state.modes?.[selfId()];
    const modeChoices = [
      ['focus','Focus','Block incoming shares'],
      ['collaborative','Collaborative','Share without approval'],
      ['approval','Approval','Ask before each share']
    ];
    modeSection.innerHTML = `<fieldset class="mode-selector"><legend>Incoming share mode</legend><p class="mode-hint">Only affects what arrives on your laptop.</p><div class="mode-options">${modeChoices.map(([value,title,description]) => `<label class="mode-option" data-mode="${value}"><input type="radio" name="incoming-mode" value="${value}" ${currentMode === value ? 'checked' : ''} ${typeof api?.setMode !== 'function' ? 'disabled' : ''}><span><strong>${title}</strong><small>${description}</small></span></label>`).join('')}</div></fieldset>`;
    document.querySelector('.workspace-exit').before(modeSection);
    modeSection.querySelectorAll('input').forEach(input => {
      input.onchange = () => action(async token => {
        try {
          await api.setMode(input.value);
          if (token !== operation || view !== 'room') return;
          state = {...state,modes:{...state.modes,[selfId()]:input.value}};
          renderRoom();
          document.querySelector(`.mode-option[data-mode="${input.value}"] input`)?.focus();
        } catch (e) {
          if (token === operation) {
            renderRoom();
            document.querySelector(`.mode-option[data-mode="${input.value}"] input`)?.focus();
          }
          throw e;
        }
      });
    });
    document.querySelector('#copy').onclick = async () => {
      const text = `Join Odyssync\nRoom: ${state.roomNumber || 'Direct IP'}\nPIN: ${state.pin || ''}${state.localIps?.length ? `\nHost IP: ${state.localIps.join(', ')}` : ''}`;
      try { await navigator.clipboard.writeText(text); notify('Invite copied.'); }
      catch { notify(`Copy invite: ${text}`); }
    };
    document.querySelector('#leave').onclick = () => action(async token => {
      await api.leaveRoom(); if (token !== operation) return;
      state = {self:state.self}; launch(); notify('You left the room.');
    });
    paintCanvas();
  }
  function managementIcon(kind) {
    const paths = kind === 'people'
      ? '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>'
      : '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/>';
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }
  function openManagement(kind) {
    if (!state.isHost) return;
    dialogKind = kind;
    document.querySelector('dialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'entry-dialog manage-dialog';
    dialog.setAttribute('aria-labelledby','management-title');
    const requests = kind === 'requests';
    const policy = state.management;
    const supported = policy && typeof api.management?.setManualApproval === 'function'
      && typeof api.management?.answerJoinRequest === 'function' && typeof api.management?.setSharingPermission === 'function';
    const editable = supported && state.isHost;
    const disabled = editable ? '' : 'disabled';
    let content;
    if(requests){
      const pending = policy?.joinRequests || [];
      content = `<label class="policy-toggle"><span><strong>Approve each new laptop</strong><small>New laptops wait for your approval before entering.</small></span><input id="manual-approval" type="checkbox" role="switch" ${policy?.manualApproval ? 'checked' : ''} ${disabled}></label><h3 class="pending-heading">Waiting to join <span>${pending.length}</span></h3><div class="join-request-list">${pending.map(request=>`<div class="join-request"><span class="person-avatar" aria-hidden="true">${esc((request.member.profile?.displayName || 'PC').slice(0,2).toUpperCase())}</span><span class="request-name"><strong>${esc(request.member.profile?.displayName || 'Laptop')}</strong><small>Would like to join your workspace</small></span><div class="request-actions"><button class="approve-request" data-request="${esc(request.requestId)}" data-accepted="true" ${disabled}>Approve</button><button class="decline-request" data-request="${esc(request.requestId)}" data-accepted="false" ${disabled}>Decline</button></div></div>`).join('') || '<div class="management-empty"><strong>No pending join requests</strong><p>Requests appear here when someone tries to join.</p></div>'}</div>${isPreview && state.isHost ? '<button class="link demo-request" id="demo-request">Demo: reconnect a laptop</button>' : ''}`;
    }else{
      content = `<p>Choose who can send tabs and files in this room. Changes save immediately.</p><div class="permission-list">${(state.members || []).map(member => {
      const displayName = member.profile?.displayName || member.displayName || 'Laptop';
      const initials = displayName.trim().slice(0,2).toUpperCase();
      const isSelfHost = state.isHost && member.deviceId === selfId();
      const value = policy?.sharingPermissions?.[member.deviceId];
      return `<label class="permission-person"><span class="person-avatar" aria-hidden="true">${esc(initials)}</span><span><strong>${esc(displayName)}</strong><small>${isSelfHost ? 'You · Host' : member.deviceId === selfId() ? 'You' : 'Room member'}</small></span><input type="checkbox" role="switch" aria-label="Allow ${esc(displayName)} to share" data-permission="${esc(member.deviceId)}" ${value === true ? 'checked' : ''} ${!editable || isSelfHost || typeof value !== 'boolean' ? 'disabled' : ''}></label>`;
    }).join('') || '<div class="management-empty">No member information available.</div>'}</div>`;
    }
    const hint = !supported ? 'Room controls are not connected yet.' : !state.isHost ? 'Only the host can change these settings.' : isPreview ? 'Demo controls · no real laptops are connected.' : '';
    dialog.innerHTML = `<button class="modal-close" id="close-management" aria-label="Close ${requests ? 'join requests' : 'sharing permissions'}">×</button><div class="management-heading"><span class="tool-icon ${requests ? 'blue' : 'orange'}" aria-hidden="true">${managementIcon(requests ? 'people' : 'shield')}</span><div><span class="label">${requests ? 'Workspace access' : 'Room policy'}</span><h2 id="management-title">${requests ? 'Join requests' : 'Sharing permissions'}</h2></div></div>${hint ? `<p class="policy-note">${hint}</p>` : ''}${content}<p class="error" id="management-error" role="alert"></p><button class="secondary management-done" id="management-done">Done</button>`;
    app.append(dialog);
    dialog.querySelector('#close-management').onclick = closeDialog;
    dialog.querySelector('#management-done').onclick = closeDialog;
    dialog.oncancel = e => { e.preventDefault(); closeDialog(); };
    async function change(task,focusSelector){
      if(busy || !editable)return;
      const token = operation;
      setBusy(true);
      try{await task();}
      catch(e){if(token===operation && view==='room'){
        openManagement(kind);
        document.querySelector('#management-error').textContent=e?.message || 'Could not save. Please try again.';
      }}
      finally{if(token===operation){setBusy(false);document.querySelector(focusSelector)?.focus();}}
    }
    dialog.querySelector('#manual-approval')?.addEventListener('change',e=>{
      change(()=>api.management.setManualApproval(e.target.checked),'#manual-approval');
    });
    dialog.querySelectorAll('[data-permission]').forEach(input=>input.onchange=()=>{
      change(()=>api.management.setSharingPermission(input.dataset.permission,input.checked),`[data-permission="${input.dataset.permission}"]`);
    });
    dialog.querySelectorAll('[data-request]').forEach(button=>button.onclick=()=>{
      change(()=>api.management.answerJoinRequest(button.dataset.request,button.dataset.accepted==='true'),'#management-done');
    });
    dialog.querySelector('#demo-request')?.addEventListener('click',()=>{
      change(()=>window.previewControls.reconnectLast(),'#management-done');
    });
    dialog.showModal();
  }
  function paintCanvas() {
    const canvas = document.querySelector('#canvas'); if (!canvas) return;
    const screens = state.screens || [];
    transform = ControlLayout.fitScreens(screens,canvas.clientWidth,canvas.clientHeight);
    if (!screens.length) { canvas.innerHTML = '<div class="empty">Waiting for screen information…</div>'; return; }
    canvas.replaceChildren();
    screens.forEach((s,i) => {
      const member = (state.members || []).find(m=>m.deviceId === s.deviceId);
      const title = member?.profile?.displayName || member?.displayName || (s.deviceId === selfId() ? selfName() : '') || `Laptop ${i+1}`;
      const el = document.createElement('div');
      el.className = `screen ${state.isHost ? 'host-draggable' : ''} ${s.deviceId === selfId() ? 'self' : ''} ${sending.has(s.deviceId) ? 'sending' : ''}`;
      el.dataset.id = s.deviceId;
      el.innerHTML = `<span class="screen-number">${String(i+1).padStart(2,'0')}</span><div class="device-art" aria-hidden="true">${laptop(['blue','orange','lime','blue'][i%4])}</div><span class="screen-name">${esc(title)}</span><span class="screen-you">${s.deviceId === selfId() ? 'Your laptop' : sending.has(s.deviceId) ? (sendCaption.get(s.deviceId) || 'Sending…') : 'Right-click: send…'}</span>`;
      position(el,s); canvas.append(el);
      if (s.deviceId !== selfId() && typeof api.sendDirect === 'function' && typeof api.listSendable === 'function') {
        const id = s.deviceId; el.tabIndex = 0; el.title = 'Right-click to send a tab, document or file';
        el.oncontextmenu = async e => {
          e.preventDefault(); if (sending.has(id)) return; sending.add(id); paintCanvas();
          let r;
          try { r = await api.listSendable(id); } catch (err) { r = null; }
          sending.delete(id); paintCanvas();
          if (!r?.ok) { notify(r?.error || 'Could not read your open windows.'); return; }
          const items = r.items || [];
          if (items.length === 1) { closeSendDialog(); await sendItem(id,title,items[0].id); return; }
          openSendDialog(id,title,items);
        };
      }
      if (state.isHost) {
        el.tabIndex = 0; el.setAttribute('aria-label',`${title}. Arrow keys select a swap target; Enter swaps.`);
        el.onpointerdown = e => startDrag(e,s,el);
        let draft = null;
        el.onkeydown = e => {
          if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
            e.preventDefault(); draft = draft || {...s};
            draft.x += e.key === 'ArrowLeft' ? -s.w/4 : e.key === 'ArrowRight' ? s.w/4 : 0;
            draft.y += e.key === 'ArrowUp' ? -s.h/4 : e.key === 'ArrowDown' ? s.h/4 : 0; showDropTarget(draft);
          }
          if (e.key === 'Enter' && draft) { e.preventDefault(); saveLayout(draft); draft = null; }
          if (e.key === 'Escape') { draft = null; showDropTarget(s); }
        };
      }
    });
  }
  const sendCaption = new Map();
  async function sendItem(id,title,itemId,after) { return sendItems(id,title,[itemId],after); }
  async function sendItems(id,title,itemIds,after) {
    sending.add(id); paintCanvas(); if (after) after();
    const n = itemIds.length; let ok = 0, firstError = '';
    for (let i = 0; i < n; i++) {
      if (n > 1) { sendCaption.set(id,`Sending ${i+1} of ${n}…`); paintCanvas(); }
      try { const r = await api.sendDirect({deviceId:id,itemId:itemIds[i]}); if (r?.ok) ok++; else if (!firstError) firstError = r?.error || 'Could not send.'; }
      catch (err) { if (!firstError) firstError = 'Could not send.'; }
    }
    sending.delete(id); sendCaption.delete(id); paintCanvas();
    notify(ok === n ? (n === 1 ? `Sent to ${title}` : `Sent ${n} items to ${title}`) : ok ? `Sent ${ok} of ${n} to ${title}. ${firstError}` : firstError || 'Could not send.');
  }
  function closeSendDialog() { document.querySelectorAll('.send-dialog').forEach(d => { if (d.open) d.close(); d.remove(); }); }
  function openSendDialog(id,title,items) {
    closeSendDialog();
    if (!items.length) { notify('Nothing to send. Open a tab or document first.'); return; }
    const dialog = document.createElement('dialog');
    dialog.className = 'entry-dialog send-dialog'; dialog.dataset.deviceId = id; dialog.setAttribute('aria-labelledby','send-title');
    const kindWord = i => i.kind === 'tab' ? 'tab' : 'file';
    dialog.innerHTML = `<form method="dialog"><h2 id="send-title">Select to send</h2><div class="send-list" role="group" aria-labelledby="send-title">${items.map((it,i) => `<button type="button" role="checkbox" aria-checked="false" data-i="${i}"><span class="send-badge ${/^(ZIP|RAR|7Z|EXE|FILE)$/i.test(it.badge||'') ? 'warm' : ''}">${esc(it.badge)}</span><span class="send-text"><b>${esc(it.name)}</b><small>${esc(it.detail)}</small></span><span class="send-check" aria-hidden="true">✓</span></button>`).join('')}</div><div class="send-footer"><span class="send-count"></span><button class="send-button" type="submit">Send</button></div></form>`;
    document.body.append(dialog);
    const rows = [...dialog.querySelectorAll('[role=checkbox]')], sendBtn = dialog.querySelector('.send-button');
    const ticked = new Set();
    const paint = () => {
      rows.forEach((row,i) => row.setAttribute('aria-checked',String(ticked.has(i))));
      const n = ticked.size, one = n === 1 ? kindWord(items[[...ticked][0]]) : '';
      dialog.querySelector('.send-count').textContent = n === 0 ? 'Nothing selected' : n === 1 ? `1 ${one} selected` : `${n} items selected`;
      sendBtn.textContent = n === 0 ? 'Send' : n === 1 ? `Send ${one}` : `Send ${n} items`; sendBtn.disabled = n === 0;
    };
    paint();
    rows.forEach((row,i) => row.onclick = () => { if (ticked.has(i)) ticked.delete(i); else ticked.add(i); paint(); });
    dialog.querySelector('.send-list').onkeydown = e => {
      if (!['ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const cur = Math.max(0,rows.indexOf(document.activeElement));
      rows[(cur + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
    };
    dialog.addEventListener('cancel',e => { e.preventDefault(); closeSendDialog(); });
    dialog.addEventListener('click',e => {
      if (e.target !== dialog) return;
      const b = dialog.getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeSendDialog();
    });
    dialog.querySelector('form').onsubmit = e => {
      e.preventDefault(); if (!ticked.size) return;
      sendItems(id,title,[...ticked].sort((a,b) => a-b).map(i => items[i].id),closeSendDialog);
    };
    dialog.showModal(); rows[0].focus();
  }
  function position(el,s) {
    el.style.left = `${transform.x+s.x*transform.scale}px`; el.style.top = `${transform.y+s.y*transform.scale}px`;
    el.style.width = `${s.w*transform.scale}px`; el.style.height = `${s.h*transform.scale}px`;
  }
  function startDrag(e,s,el) {
    if (e.button !== 0 || busy || drag) return;
    e.preventDefault(); el.focus(); el.setPointerCapture(e.pointerId);
    const canvasBounds = document.querySelector('#canvas').getBoundingClientRect();
    const activeDrag = {id:s.deviceId,startX:e.clientX,startY:e.clientY,draft:{...s},frame:0,pointer:null};
    drag = activeDrag;
    el.classList.add('dragging');
    function drawDrag() {
      activeDrag.frame = 0;
      if (drag !== activeDrag || !activeDrag.pointer) return;
      const {x,y} = activeDrag.pointer;
      // Transform the existing tile once per frame; no canvas rebuild or layout writes.
      el.style.transform = `translate3d(${x-activeDrag.startX}px,${y-activeDrag.startY}px,0)`;
      activeDrag.draft = {...s,x:(x-canvasBounds.left-transform.x)/transform.scale-s.w/2,
        y:(y-canvasBounds.top-transform.y)/transform.scale-s.h/2};
      showDropTarget(activeDrag.draft);
    }
    el.onpointermove = event => {
      if (drag !== activeDrag) return;
      activeDrag.pointer = {x:event.clientX,y:event.clientY};
      if (!activeDrag.frame) activeDrag.frame = requestAnimationFrame(drawDrag);
    };
    el.onpointerup = () => {
      if (drag !== activeDrag) return;
      cancelAnimationFrame(activeDrag.frame); drawDrag();
      const draft = activeDrag.draft; drag = null; saveLayout(draft);
    };
    el.onpointercancel = () => {
      if (drag !== activeDrag) return;
      cancelAnimationFrame(activeDrag.frame); drag = null; paintCanvas();
    };
  }
  function showDropTarget(draft) {
    const target = ControlLayout.swapTarget(draft,state.screens || []);
    document.querySelectorAll('.screen').forEach(el => {
      el.classList.toggle('swap-target',el.dataset.id===target?.deviceId);
    });
  }
  async function saveLayout(draft) {
    if (!state.isHost || busy) return;
    const next = ControlLayout.arrangeScreens(draft,state.screens || []);
    if (!next) { notify('No free edge here. Try another position.'); paintCanvas(); return; }
    const previous = state.screens;
    const token = operation;
    state = {...state,screens:next}; paintCanvas(); busy = true;
    try { await api.setLayout(next); }
    catch (e) { if (token === operation) { state = {...state,screens:previous}; paintCanvas(); notify(e?.message || 'Could not save the layout.'); } }
    finally { if (token === operation) { busy = false; document.querySelector(`[data-id="${draft.deviceId}"]`)?.focus(); } }
  }
  try { if (localStorage.getItem('odyssync.theme') === 'light') document.body.classList.add('light'); } catch {}
  if (api) {
    api.onState(next => {
      state = next; if (!name) name = selfName(); if (drag) drag = null;
      const sd = document.querySelector('.send-dialog');
      if (sd && !(state.members || []).some(m => m.deviceId === sd.dataset.deviceId) && !(state.screens || []).some(x => x.deviceId === sd.dataset.deviceId)) closeSendDialog();
      if (view === 'room') {
        const managementDialog = state.isHost && ['requests','permissions'].includes(dialogKind) ? dialogKind : null;
        if (!state.isHost) dialogKind = null;
        renderRoom();
        if (managementDialog) openManagement(managementDialog);
      }
      else if (!dialogKind && document.activeElement?.id !== 'name') render();
    });
    api.onNotice(notice => {
      if (['kicked','room_closed'].includes(notice.kind)) { operation++; busy = false; drag = null; state = {self:state.self}; launch(); }
      notify(notice.text || 'The room connection changed.');
    });
  }
  new ResizeObserver(() => { if (!drag) paintCanvas(); }).observe(app);
  render();
})();
