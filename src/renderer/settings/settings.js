'use strict';
(() => {
  const api = window.sipSettings;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Builds elements with textContent only: names and reminder titles can never be interpreted as markup.
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, ''); else n.setAttribute(k, String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };

  let V = null, editingId = null, toastTimer = null;
  const sigs = {};
  const changed = (key, val) => { const s = JSON.stringify(val); if (sigs[key] === s) return false; sigs[key] = s; return true; };
  const setVal = (input, v) => { if (document.activeElement !== input && input.value !== String(v)) input.value = String(v); };
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d; };

  // ---------- Small helpers ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function fmtWhen(ts) {
    if (!ts) return '—';
    const d = new Date(ts), n = new Date(), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const days = Math.round((startOfDay(d) - startOfDay(n)) / 86400000);
    if (days === 0) return 'Today, ' + time;
    if (days === 1) return 'Tomorrow, ' + time;
    if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'long' }) + ', ' + time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() !== n.getFullYear() ? 'numeric' : undefined }) + ', ' + time;
  }
  function toast(msg, bad) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }
  async function patch(p) {
    try {
      const r = await api.patch(p); V = r.view; render();
      if (r.rejected && r.rejected.length) toast('One of those values was not accepted, so it was left as it was.', true);
    } catch (e) { toast('Could not save that change.', true); }
  }

  // ---------- Tabs ----------
  function showTab(name, focusTab) {
    for (const b of $$('[role="tab"]')) {
      const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus();
    }
    for (const p of $$('[role="tabpanel"]')) p.hidden = p.id !== 'panel-' + name;
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[role="tab"]'); if (b) showTab(b.dataset.tab); });
  $('#tabs').addEventListener('keydown', e => {
    const tabs = $$('[role="tab"]'), i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (move) { e.preventDefault(); showTab(tabs[(i + move + tabs.length) % tabs.length].dataset.tab, true); }
  });

  // ---------- Look / sound lists ----------
  function pickList(container, items, selected, name, onPick, onRemove, extra) {
    if (!changed('list:' + name, [items, selected])) return;
    container.replaceChildren(...items.map(it => el('div', { class: 'item' },
      el('label', {}, el('input', { type: 'radio', name, value: it.id, checked: it.id === selected, onchange: () => onPick(it.id) }), el('span', { text: it.label, title: it.label })),
      extra ? extra(it) : null,
      it.user ? el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + it.label, text: 'Remove', onclick: () => onRemove(it) }) : null)));
  }
  async function addFile(kind) {
    try {
      const r = await api.addFile(kind);
      if (r.canceled) return;
      if (!r.ok) { toast(r.error || 'Could not add that file.', true); return; }
      V = r.view; render(); toast('Added and selected.');
    } catch (e) { toast('Could not add that file.', true); }
  }
  async function removeFile(kind, it) {
    try { const r = await api.removeFile(kind, it.id); V = r.view; render(); toast(r.ok ? 'Removed.' : 'Could not remove that file.', !r.ok); } catch (e) { toast('Could not remove that file.', true); }
  }

  // ---------- Render ----------
  function render() {
    if (!V) return;
    renderCharacters(); renderReminders(); renderSounds(); renderGeneral();
    $('#sideFoot').textContent = 'Version ' + V.version;
    renderAbout();
  }
  function renderAbout() {
    const A = V.about; if (!A) return;
    $('#brandAuthor').textContent = A.author;
    $('#aboutLine').textContent = `${A.name} ${V.version} · ${A.license} licence · made by ${A.author}. Free for everyone to use and improve.`;
    for (const a of $$('a[data-link]')) {          // the address is shown for transparency; clicking sends only the key to the main program
      const url = A.links[a.dataset.link]; if (!url) continue;
      a.href = url; a.title = url; a.setAttribute('aria-label', a.textContent.trim() + ' (opens in your browser)');
    }
  }
  function renderCharacters() {
    for (const r of $$('input[name="show"]')) r.checked = r.value === V.show;
    $('#heroCard').classList.toggle('dim', V.show === 'pet'); $('#petCard').classList.toggle('dim', V.show === 'hero');
    setVal($('#heroName'), V.hero.name); setVal($('#petName'), V.pet.name);
    pickList($('#heroLooks'), V.heroLooks, V.hero.look, 'heroLook', id => patch({ hero: { look: id } }), it => removeFile('avatar', it));
    pickList($('#petLooks'), V.petLooks, V.pet.look, 'petLook', id => patch({ pet: { look: id } }), it => removeFile('pet', it));
    $('#petFlip').checked = !!V.pet.flip;
    for (const r of $$('input[name="speed"]')) r.checked = Number(r.value) === Number(V.pet.speed);
  }
  function renderSounds() {
    $('#muteAll').checked = !!V.sound.mute; $('#sndVoice').checked = !!V.sound.voice; $('#sndPet').checked = !!V.sound.pet; $('#sndFx').checked = !!V.sound.fx;
    const pct = Math.round(V.sound.volume * 100); setVal($('#vol'), pct); $('#volOut').textContent = String(pct);
    pickList($('#petSounds'), V.petSounds, V.pet.sound, 'petSound', async id => { await patch({ pet: { sound: id } }); api.playSound(id); }, it => removeFile('sound', it),
      it => el('button', { type: 'button', class: 'btn small', 'aria-label': 'Play ' + it.label, text: '▶ Play', onclick: () => api.playSound(it.id) }));
  }
  function renderGeneral() {
    $('#startAtLogin').checked = !!V.startAtLogin; $('#startAtLogin').disabled = !V.autostartSupported; $('#loginNote').hidden = V.autostartSupported;
    $('#diagHero').textContent = V.diag.hero; $('#diagPet').textContent = V.diag.pet;
    $('#diagVer').textContent = `Sip ${V.version} · Electron ${V.electron} · ${V.platform}`;
  }
  function renderReminders() {
    const w = V.water;
    $('#waterOn').checked = w.enabled; $('#waterCard').classList.toggle('off', !w.enabled);
    setVal($('#waterEvery'), w.interval); setVal($('#waterGoal'), w.goal);
    if (changed('waterChips', w.interval)) $('#waterChips').replaceChildren(...[15, 20, 30, 45, 60, 90].map(m =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(m === w.interval), text: m + ' min', onclick: () => patch({ water: { interval: m } }) })));
    $('#waterToday').textContent = `Today: ${w.count} of ${w.goal} glasses` + (w.enabled ? ` · next check-in ${fmtWhen(w.nextAt)}` : '');
    const sorted = [...V.reminders].sort((a, b) => (a.done - b.done) || (!a.enabled - !b.enabled) || ((a.nextAt || 9e15) - (b.nextAt || 9e15)));
    $('#clearDone').hidden = !V.reminders.some(r => r.done);
    $('#remEmpty').hidden = V.reminders.length > 0;
    if (!changed('remList', [sorted, Math.floor(V.now / 60000)])) return;
    $('#remList').replaceChildren(...sorted.map(reminderRow));
  }
  function reminderRow(r) {
    const due = r.enabled && !r.done && r.nextAt && r.nextAt < V.now - 60000;
    const status = r.done ? 'Done' : !r.enabled ? 'Paused' : due ? 'Due' : null;
    const meta = r.done ? r.describe : `${r.describe} · next: ${fmtWhen(r.nextAt)}`;
    let confirmTimer = null;
    const del = el('button', { type: 'button', class: 'btn small', 'aria-label': 'Delete ' + r.title, text: 'Delete' });
    del.addEventListener('click', async () => {
      if (!del.classList.contains('danger')) { del.classList.add('danger'); del.textContent = 'Really delete?'; confirmTimer = setTimeout(() => { del.classList.remove('danger'); del.textContent = 'Delete'; }, 3000); return; }
      clearTimeout(confirmTimer); V = await api.reminderDelete(r.id); if (editingId === r.id) resetForm(); render(); toast('Deleted.');
    });
    return el('li', { class: 'rem' + (r.done ? ' done' : !r.enabled ? ' paused' : '') },
      el('div', { class: 'body' },
        el('div', { class: 'title' }, r.title, status ? el('span', { class: 'badge' + (due ? ' warn' : ''), text: status }) : null),
        r.note ? el('div', { class: 'note', text: r.note }) : null,
        el('div', { class: 'meta', text: meta })),
      el('div', { class: 'acts' },
        el('label', { class: 'switch', title: r.enabled ? 'Pause' : 'Turn on' },
          el('input', { type: 'checkbox', checked: r.enabled && !r.done, 'aria-label': (r.enabled ? 'Pause ' : 'Turn on ') + r.title, onchange: e => toggleReminder(r, e.target.checked) }),
          el('span', { class: 'track', 'aria-hidden': 'true' })),
        el('button', { type: 'button', class: 'btn small', text: 'Test', 'aria-label': 'Show ' + r.title + ' now', onclick: async () => { const t = await api.reminderTest(r.id); toast(t.ok ? 'Showing it now…' : 'A check-in is already on screen. Answer it first.', !t.ok); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Edit', 'aria-label': 'Edit ' + r.title, onclick: () => startEdit(r) }),
        del));
  }
  async function toggleReminder(r, on) {
    const res = await api.reminderUpdate(r.id, { enabled: on }); V = res.view; render();
    if (!res.ok) toast(res.error || 'Could not change that reminder.', true);
  }

  // ---------- Reminder form ----------
  const KIND_BOX = { once: '#kind-once', daily: '#kind-daily', weekly: '#kind-weekly', interval: '#kind-interval' };
  const currentKind = () => $('input[name="kind"]:checked').value;
  function showKind(k) { for (const [kk, sel] of Object.entries(KIND_BOX)) $(sel).hidden = kk !== k; }
  function showError(msg) { const e = $('#formError'); e.textContent = msg || ''; e.hidden = !msg; }
  function defaultOnce() { const t = new Date(Math.ceil((Date.now() + 3600000) / 300000) * 300000); $('#remDate').value = ymd(t); $('#remDate').min = ymd(new Date()); $('#remTimeOnce').value = hm(t); }
  function buildDays() {
    $('#remDays').replaceChildren(...[[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']].map(([d, name]) =>
      el('button', { type: 'button', class: 'chip', 'data-day': d, 'aria-pressed': String(d >= 1 && d <= 5), text: name,
        onclick: e => e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.getAttribute('aria-pressed') !== 'true')) })));
  }
  function readForm() {
    const kind = currentKind(), o = { title: $('#remTitle').value, note: $('#remNote').value, kind };
    if (kind === 'once') { o.date = $('#remDate').value; o.at = $('#remTimeOnce').value; }
    if (kind === 'daily') o.at = $('#remTimeDaily').value;
    if (kind === 'weekly') { o.days = $$('#remDays [aria-pressed="true"]').map(b => Number(b.dataset.day)); o.at = $('#remTimeWeekly').value; }
    if (kind === 'interval') o.every = Number($('#remEvery').value) * Number($('#remUnit').value);
    return o;
  }
  function resetForm() {
    editingId = null; $('#remTitle').value = ''; $('#remNote').value = ''; showError('');
    $('#formTitle').textContent = 'Add a reminder'; $('#remSubmit').textContent = 'Add reminder'; $('#remCancel').hidden = true;
    defaultOnce();
  }
  function startEdit(r) {
    editingId = r.id; showTab('reminders');
    $('#remTitle').value = r.title; $('#remNote').value = r.note || '';
    for (const x of $$('input[name="kind"]')) x.checked = x.value === r.kind; showKind(r.kind);
    if (r.kind === 'once') { $('#remDate').value = r.date; $('#remTimeOnce').value = r.at; }
    if (r.kind === 'daily') $('#remTimeDaily').value = r.at;
    if (r.kind === 'weekly') { $('#remTimeWeekly').value = r.at; for (const b of $$('#remDays .chip')) b.setAttribute('aria-pressed', String((r.days || []).includes(Number(b.dataset.day)))); }
    if (r.kind === 'interval') { const hours = r.every % 60 === 0; $('#remUnit').value = hours ? '60' : '1'; $('#remEvery').value = String(hours ? r.every / 60 : r.every); }
    $('#formTitle').textContent = 'Edit reminder'; $('#remSubmit').textContent = 'Save changes'; $('#remCancel').hidden = false; showError('');
    $('#addCard').scrollIntoView({ block: 'start' }); $('#remTitle').focus();
  }
  async function submitReminder(input) {
    showError('');
    if (!input.title.trim()) { showError('Type what you want to be reminded about.'); $('#remTitle').focus(); return; }
    try {
      const res = editingId ? await api.reminderUpdate(editingId, input) : await api.reminderAdd(input);
      V = res.view;
      if (!res.ok) { showError(res.error || 'That did not work. Please check the details.'); render(); return; }
      const wasEdit = !!editingId;
      resetForm(); render();
      const latest = wasEdit ? null : V.reminders[V.reminders.length - 1];
      toast(wasEdit ? 'Changes saved.' : 'Reminder added' + (latest && latest.nextAt ? ' · first one: ' + fmtWhen(latest.nextAt) : '.'));
    } catch (e) { showError('Could not save the reminder.'); }
  }
  function quickAdd(v) {
    const title = $('#remTitle').value;
    if (!title.trim()) { showError('Type what to remind you about first, then pick a time.'); $('#remTitle').focus(); return; }
    let t;
    if (v === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); t = d.getTime(); }
    else t = Math.ceil((Date.now() + Number(v) * 60000) / 60000) * 60000;
    const d = new Date(t); editingId = null;
    submitReminder({ title, note: $('#remNote').value, kind: 'once', date: ymd(d), at: hm(d) });
  }

  // ---------- Wire up controls ----------
  for (const r of $$('input[name="show"]')) r.addEventListener('change', () => { if (r.checked) patch({ show: r.value }); });
  for (const [input, who] of [[$('#heroName'), 'hero'], [$('#petName'), 'pet']]) {
    const send = debounce(() => { if (input.value.trim()) patch({ [who]: { name: input.value } }); }, 450);
    input.addEventListener('input', send);
    input.addEventListener('blur', () => { send.flush(); if (!input.value.trim()) render(); });
  }
  $('#addAvatar').addEventListener('click', () => addFile('avatar'));
  $('#addPet').addEventListener('click', () => addFile('pet'));
  $('#addSound').addEventListener('click', () => addFile('sound'));
  $('#petFlip').addEventListener('change', e => patch({ pet: { flip: e.target.checked } }));
  for (const r of $$('input[name="speed"]')) r.addEventListener('change', () => { if (r.checked) patch({ pet: { speed: Number(r.value) } }); });

  $('#waterOn').addEventListener('change', e => patch({ water: { enabled: e.target.checked } }));
  $('#waterEvery').addEventListener('input', debounce(e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) patch({ water: { interval: n } }); }, 500));
  $('#waterGoal').addEventListener('input', debounce(e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) patch({ water: { goal: n } }); }, 500));
  const water = async op => { try { V = await api.water(op); render(); } catch (e) { toast('Could not change that.', true); } };
  $('#waterMinus').addEventListener('click', () => water({ delta: -1 }));
  $('#waterPlus').addEventListener('click', () => water({ delta: 1 }));
  $('#waterReset').addEventListener('click', () => water({ reset: true }));

  for (const r of $$('input[name="kind"]')) r.addEventListener('change', () => showKind(currentKind()));
  $('#quickChips').addEventListener('click', e => { const b = e.target.closest('[data-quick]'); if (b) quickAdd(b.dataset.quick); });
  $('#remSubmit').addEventListener('click', () => submitReminder(readForm()));
  $('#remCancel').addEventListener('click', () => { resetForm(); render(); });
  $('#remTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitReminder(readForm()); } });
  $('#clearDone').addEventListener('click', async () => { V = await api.reminderClearDone(); render(); toast('Cleared.'); });

  $('#muteAll').addEventListener('change', e => patch({ sound: { mute: e.target.checked } }));
  $('#sndVoice').addEventListener('change', e => patch({ sound: { voice: e.target.checked } }));
  $('#sndPet').addEventListener('change', e => patch({ sound: { pet: e.target.checked } }));
  $('#sndFx').addEventListener('change', e => patch({ sound: { fx: e.target.checked } }));
  const sendVol = debounce(v => patch({ sound: { volume: v / 100 } }), 200);
  $('#vol').addEventListener('input', e => { $('#volOut').textContent = e.target.value; sendVol(Number(e.target.value)); });

  $('#startAtLogin').addEventListener('change', e => patch({ startAtLogin: e.target.checked }));
  $('#askNow').addEventListener('click', async () => { const t = await api.askNow(); toast(t.ok ? 'Here I come!' : 'A check-in is already on screen. Answer it first.', !t.ok); });
  $('#openLog').addEventListener('click', () => api.openLog());
  document.addEventListener('click', async e => {
    const a = e.target.closest('a[data-link]'); if (!a) return;
    e.preventDefault();
    try { const r = await api.openLink(a.dataset.link); if (!r.ok) toast('Could not open that link.', true); } catch (err) { toast('Could not open that link.', true); }
  });

  api.onState(v => { V = v; render(); });
  api.onNotice(m => toast(m, true));
  api.onNavigate(t => { if (t === 'reminders-add') { showTab('reminders'); $('#remTitle').focus(); } else if (t) showTab(t); });

  buildDays(); defaultOnce(); showKind('once');
  api.getState().then(v => { V = v; render(); }).catch(() => toast('Could not load settings.', true));
  setInterval(() => { if (V) { V.now = Date.now(); renderReminders(); } }, 30000);   // keep "next: ..." and the Due badge fresh
})();
