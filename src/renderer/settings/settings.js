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
      if (r.rejected && r.rejected.length) toast(r.rejected.includes('water.window') ? 'Pick a start and an end that are different times.' : 'One of those values was not accepted, so it was left as it was.', true);
      return r;
    } catch (e) { toast('Could not save that change.', true); return null; }
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
    const tabs = $$('[role="tab"]').filter(t => !t.hidden), i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
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
    renderCharacters(); renderReminders(); renderSounds(); renderGeneral(); renderTodos(); renderToday(); renderStats();
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
    const B = V.behavior || { leave: 'normal', leaveSecs: 8, parked: false, spot: null };
    for (const r of $$('input[name="leave"]')) r.checked = r.value === B.leave;
    setVal($('#leaveSecs'), B.leaveSecs); $('#leaveSecsRow').hidden = B.leave !== 'custom';
    $('#parkedOn').checked = !!B.parked; $('#parkedOn').disabled = !B.spot; $('#forgetSpot').disabled = !B.spot;
    $('#spotNote').textContent = B.spot ? `Your spot is saved (about ${B.spot.x}, ${B.spot.y} on your screen).` : 'No spot chosen yet. Until you pick one, they wait at a random place.';
    $('#diagHero').textContent = V.diag.hero; $('#diagPet').textContent = V.diag.pet;
    $('#diagVer').textContent = `Sip ${V.version} · Electron ${V.electron} · ${V.platform}`;
  }
  // ---------- Today (answered check-ins, editable) ----------
  const KIND_ICON = { water: '\u{1F4A7}', reminder: '⏰', todo: '✅' };
  const ACTIONS = [['done', 'Done'], ['skip', 'Skipped'], ['snooze', 'Not yet']];
  function renderToday() {
    const T = V.today, log = V.dayLog;
    if (!changed('today', [T, log])) return;
    const tile = (big, lbl) => el('div', { class: 'tile' }, el('div', { class: 'big', text: big }), el('div', { class: 'lbl', text: lbl }));
    $('#todayTiles').replaceChildren(tile(`${T.count} of ${T.goal}`, 'glasses today'), tile(String(T.skips), `skipped (${T.skipMin ? T.skipMin + ' min' : 'no time lost'})`),
      tile(String(T.snoozes), '“Not yet” taps'), tile(String(log.length), 'check-ins answered'));
    $('#logEmpty').hidden = log.length > 0;
    $('#logList').replaceChildren(...[...log].reverse().map(e => {
      const sel = el('select', { 'aria-label': 'Answer for ' + e.title, onchange: ev => logEdit(e.id, ev.target.value) }, ...ACTIONS.map(a => el('option', { value: a[0], text: a[1] })));
      sel.value = e.action;
      const label = e.type === 'water' ? 'Water check-in' : e.type === 'todo' ? 'To do: ' + e.title : e.title;
      return el('li', { class: 'st-' + e.action },
        el('span', { class: 'lt', text: new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) }),
        el('span', { class: 'lk', 'aria-hidden': 'true', text: KIND_ICON[e.type] || '' }),
        el('span', { class: 'lm', text: label + (e.action === 'snooze' && e.minutes ? ` (asked again in ${e.minutes} min)` : '') }),
        sel,
        el('button', { type: 'button', class: 'btn small', title: 'Remove from today’s list', 'aria-label': 'Remove: ' + label, text: '✕', onclick: () => logEdit(e.id, 'delete') }));
    }));
  }
  // Main asks "Are you sure?" in a native dialog before anything changes; on Cancel the list is simply redrawn as it was.
  async function logEdit(id, action) {
    try {
      const r = await api.logEdit(id, action);
      if (r && r.view) V = r.view;
      if (r && r.ok) toast(action === 'delete' ? 'Removed.' : 'Updated.');
      else if (r && !r.cancelled) toast(r.error || 'Could not change that.', true);
    } catch (e) { toast('Could not change that.', true); }
    sigs.today = null; render();
  }

  // ---------- To-dos ----------
  function renderTodos() {
    const on = !!(V.features && V.features.todos);
    $('#tab-todos').hidden = !on;
    if (!on && !$('#panel-todos').hidden) showTab('general');
    $('#todosOn').checked = on;
    $('#todoRemOn').checked = !!V.todoRemind.enabled; fillRemind($('#todoRemBefore'), false, String(V.todoRemind.before)); $('#todoRemBefore').disabled = !V.todoRemind.enabled;
    fillRemind($('#todoAddRemind'), true, $('#todoAddRemind').value || '');
    // open items: soonest deadline first, then the ones without a deadline in the order they were added
    const open = V.todos.filter(t => !t.done).sort((a, b) => (a.dueAt == null) - (b.dueAt == null) || (a.dueAt - b.dueAt) || a.createdAt - b.createdAt), done = V.todos.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const late = open.filter(t => t.overdue).length;
    $('#todoCount').textContent = open.length ? `To do (${open.length}${late ? ', ' + late + ' overdue' : ''})` : 'To do';
    $('#todoEmpty').hidden = V.todos.length > 0; $('#todoClear').hidden = done.length === 0;
    if (!changed('todos', V.todos)) return;
    $('#todoList').replaceChildren(...[...open, ...done].map(t => {
      const date = t.due ? t.due.slice(0, 10) : '', time = t.due && t.due.length > 10 ? t.due.slice(11) : '', badge = dueBadge(t);
      const save = () => { const d = dateIn.value; todoDue(t.id, d ? d + (timeIn.value ? 'T' + timeIn.value : '') : ''); };
      const dateIn = el('input', { type: 'date', value: date, 'aria-label': 'Deadline date for ' + t.text, onchange: save });
      const timeIn = el('input', { type: 'time', value: time, 'aria-label': 'Deadline time for ' + t.text, disabled: !date, onchange: save });
      const remSel = el('select', { 'aria-label': 'Reminder for ' + t.text, title: 'Reminder before the deadline', disabled: !date || t.done, onchange: e => todoRemind(t.id, e.target.value) });
      fillRemind(remSel, true, t.remind === null ? '' : String(t.remind));
      return el('li', { class: (t.done ? 'done ' : '') + (t.overdue ? 'late' : '') },
        el('div', { class: 'todoline' },
          el('label', {}, el('input', { type: 'checkbox', checked: t.done, onchange: e => todoDone(t.id, e.target.checked) }), el('span', { text: t.text })),
          el('button', { type: 'button', class: 'btn small', title: 'Delete', 'aria-label': 'Delete: ' + t.text, text: '✕', onclick: () => todoDelete(t.id) })),
        el('div', { class: 'dueline' }, el('span', { text: 'Deadline' }), dateIn, timeIn, el('span', { text: 'Remind' }), remSel, badge));
    }));
  }
  async function todoCall(fn) { try { const r = await fn(); if (r && r.view) { V = r.view; render(); } return r; } catch (e) { toast('Could not change the to-do list.', true); return null; } }
  const todoDone = (id, done) => todoCall(() => api.todoDone(id, done));
  // choices for "remind me before the deadline"; the value is '' (use the global setting), 'off', or minutes
  const REMIND = [['0', 'At the deadline'], ['5', '5 minutes before'], ['10', '10 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['120', '2 hours before'], ['1440', '1 day before']];
  function fillRemind(sel, perTodo, value) {
    const opts = [...(perTodo ? [['', 'Default'], ['off', 'No reminder']] : []), ...REMIND];
    if (value && !opts.some(o => o[0] === value)) opts.push([value, `${value} minutes before`]);
    const sig = JSON.stringify(opts); if (sel.dataset.sig !== sig) { sel.replaceChildren(...opts.map(o => el('option', { value: o[0], text: o[1] }))); sel.dataset.sig = sig; }
    if (document.activeElement !== sel) sel.value = value;
  }
  const remindVal = v => v === '' ? null : v === 'off' ? 'off' : Number(v);
  async function todoRemind(id, v) { const r = await todoCall(() => api.todoRemind(id, remindVal(v))); if (r && !r.ok) toast(r.error || 'Pick a valid reminder time.', true); }
  async function todoDue(id, due) { const r = await todoCall(() => api.todoDue(id, due)); if (r && !r.ok) toast(r.error || 'Pick a valid deadline.', true); }
  // "Overdue", "Due today", "Due tomorrow", "Due in 3 days", with the time when one was set
  function dueBadge(t) {
    if (!t.due) return null;
    const at = new Date(t.dueAt), time = t.due.length > 10 ? ', ' + t.due.slice(11) : '';
    const days = Math.round((startOfDay(at) - startOfDay(new Date(V.now))) / 86400000);
    if (t.done) return el('span', { class: 'badge', text: 'Was due ' + at.toLocaleDateString([], { day: 'numeric', month: 'short' }) + time });
    if (t.overdue) return el('span', { class: 'badge late', text: 'Overdue \u00b7 ' + at.toLocaleDateString([], { day: 'numeric', month: 'short' }) + time });
    return el('span', { class: days <= 1 ? 'badge soon' : 'badge', text: (days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`) + time });
  }
  const todoDelete = id => todoCall(() => api.todoDelete(id));

  // ---------- Stats (last 30 days) ----------
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v));
    for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim();
  const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  function niceStep(raw) { const e = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; }
  // One bar per day. opts: value(d), cls(d), text(d) for the hover/screen-reader title, goal(d) for the dashed line.
  function barChart(host, days, opts) {
    const W = 840, H = opts.height || 220, ml = 38, mr = 8, mt = 10, mb = 24, n = days.length;
    const vals = days.filter(d => d.has).map(opts.value), goals = opts.goal ? days.filter(d => d.has).map(opts.goal) : [];
    const lo = Math.min(0, ...vals), hi = Math.max(opts.minTop || 1, ...vals, ...goals);
    const step = niceStep((hi - lo) / 4), top = Math.ceil(hi / step) * step, bot = Math.floor(lo / step) * step;
    const y = v => mt + (H - mt - mb) * (1 - (v - bot) / (top - bot || 1)), slot = (W - ml - mr) / n, bw = Math.max(3, slot * 0.66);
    const g = svg('g');
    for (let v = bot; v <= top + 1e-9; v += step) g.append(svg('line', { class: v === 0 ? 'zero' : 'grid', x1: ml, x2: W - mr, y1: y(v), y2: y(v) }), svg('text', { class: 'axis', x: ml - 6, y: y(v) + 4, 'text-anchor': 'end' }, Math.round(v * 10) / 10));
    days.forEach((d, i) => {
      const x = ml + slot * i + (slot - bw) / 2;
      if (i % 5 === n % 5 || i === n - 1) g.append(svg('text', { class: 'axis', x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, fmtDay(d.d)));
      if (!d.has) { g.append(svg('rect', { class: 'nodata', x, y: y(0) - 1.5, width: bw, height: 3 }, svg('title', {}, `${fmtDay(d.d)}: no data`))); return; }
      const v = opts.value(d), y0 = y(0), y1 = y(v);
      g.append(svg('rect', { class: opts.cls(d), x, y: Math.min(y0, y1), width: bw, height: Math.max(1.5, Math.abs(y0 - y1)), rx: 2 }, svg('title', {}, `${fmtDay(d.d)}: ${opts.text(d)}`)));
    });
    if (opts.goal) { const pts = days.map((d, i) => d.has ? `${(ml + slot * i + slot / 2).toFixed(1)},${y(opts.goal(d)).toFixed(1)}` : null).filter(Boolean); if (pts.length) g.append(svg('polyline', { class: 'goal', points: pts.join(' ') })); }
    host.replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label, preserveAspectRatio: 'xMidYMid meet' }, g));
  }
  function renderStats() {
    const S = V.stats; if (!S || !changed('stats', S)) return;
    const T = S.totals, tile = (big, lbl) => el('div', { class: 'tile' }, el('div', { class: 'big', text: big }), el('div', { class: 'lbl', text: lbl }));
    $('#statTiles').replaceChildren(
      tile(T.trackedDays ? String(T.avgPerDay) : '—', 'glasses a day on average'),
      tile(`${T.goalDays} of ${T.trackedDays}`, 'days you reached your goal'),
      tile(T.trackedDays ? signed(T.avgDeviation) : '—', 'average deviation from goal (glasses)'),
      tile(String(T.skips), 'check-ins skipped'),
      tile(fmtMin(T.skipMin), 'skipped time'),
      tile(String(T.snoozes), `“Not yet” taps (${fmtMin(T.snoozeMin)})`));
    barChart($('#chartGlasses'), S.days, { value: d => d.n, goal: d => d.goal, cls: d => d.n >= d.goal ? 'bar-ok' : 'bar-low', text: d => `${d.n} of ${d.goal} glasses`, label: 'Glasses per day for the last 30 days, with your goal', minTop: 4 });
    barChart($('#chartDev'), S.days, { value: d => d.deviation, cls: d => d.deviation >= 0 ? 'bar-ok' : 'bar-bad', text: d => `${signed(d.deviation)} glasses against a goal of ${d.goal}`, label: 'Deviation from your goal for the last 30 days', height: 180, minTop: 2 });
    barChart($('#chartSkip'), S.days, { value: d => d.skipMin, cls: () => 'bar-warn', text: d => `${d.skips} skipped, ${fmtMin(d.skipMin)}`, label: 'Skipped time per day for the last 30 days', height: 160, minTop: 10 });
    $('#statTable tbody').replaceChildren(...[...S.days].reverse().map(d => d.has
      ? el('tr', {}, el('th', { scope: 'row', text: fmtDay(d.d) }), el('td', { text: d.n }), el('td', { text: d.goal }), el('td', { text: signed(d.deviation) }), el('td', { text: d.skips }), el('td', { text: d.skipMin ? fmtMin(d.skipMin) : '—' }), el('td', { text: d.snoozes }))
      : el('tr', { class: 'empty' }, el('th', { scope: 'row', text: fmtDay(d.d) }), el('td', { colspan: 6, text: 'no data' }))));
  }

  // ---------- Water window ----------
  function inWindowNow(w) {
    if (!w.window.enabled) return true;
    const d = new Date(V.now), m = d.getHours() * 60 + d.getMinutes(), t = x => +x.slice(0, 2) * 60 + +x.slice(3), a = t(w.window.start), b = t(w.window.end);
    return a < b ? (m >= a && m < b) : (m >= a || m < b);
  }
  function renderWindow(w) {
    const win = w.window; $('#winOn').checked = win.enabled;
    setVal($('#winStart'), win.start); setVal($('#winEnd'), win.end);
    $('#winStart').disabled = $('#winEnd').disabled = !win.enabled;
    $('#winNote').textContent = !win.enabled ? 'Off: Sip asks all day, at the interval above.'
      : `Sip asks between ${win.start} and ${win.end}. After ${win.end} it goes quiet and the next ask is at ${win.start}. ` +
        (inWindowNow(w) ? 'Right now you are inside the window.' : 'Right now you are outside the window.') + ' Change the hours any time; a longer window brings the asks back.';
  }
  function renderReminders() {
    const w = V.water;
    $('#waterOn').checked = w.enabled; $('#waterCard').classList.toggle('off', !w.enabled);
    setVal($('#waterEvery'), w.interval); setVal($('#waterGoal'), w.goal);
    if (changed('waterChips', w.interval)) $('#waterChips').replaceChildren(...[15, 20, 30, 45, 60, 90].map(m =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(m === w.interval), text: m + ' min', onclick: () => patch({ water: { interval: m } }) })));
    renderWindow(w);
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

  $('#todosOn').addEventListener('change', e => patch({ features: { todos: e.target.checked } }));
  const syncDueAdd = () => { const has = !!$('#todoDue').value; $('#todoDueTime').disabled = !has; $('#todoAddRemind').disabled = !has; if (!has) $('#todoAddRemind').value = ''; $('#todoDueClear').hidden = !has; if (!has) $('#todoDueTime').value = ''; };
  $('#todoDue').addEventListener('input', syncDueAdd);
  $('#todoDueClear').addEventListener('click', () => { $('#todoDue').value = ''; syncDueAdd(); });
  $('#todoForm').addEventListener('submit', async e => {
    e.preventDefault(); const input = $('#todoText'), text = input.value.trim(), err = $('#todoErr');
    if (!text) { err.textContent = 'Type what you need to do.'; err.hidden = false; input.focus(); return; }
    const d = $('#todoDue').value, due = d ? d + ($('#todoDueTime').value ? 'T' + $('#todoDueTime').value : '') : '';
    const r = await todoCall(() => api.todoAdd(text, due, due ? remindVal($('#todoAddRemind').value) : null));
    if (r && r.ok) { input.value = ''; $('#todoDue').value = ''; syncDueAdd(); err.hidden = true; } else if (r) { err.textContent = r.error || 'Could not add that.'; err.hidden = false; }
    input.focus();
  });
  const winPatch = (k, el_) => async () => { const r = await patch({ water: { window: { [k]: k === 'enabled' ? el_.checked : el_.value } } }); if (r && r.rejected && r.rejected.length) { renderWindow(V.water); } };
  $('#winOn').addEventListener('change', winPatch('enabled', $('#winOn')));
  $('#winStart').addEventListener('change', e => { if (e.target.value) { e.target.blur(); winPatch('start', e.target)(); } });
  $('#winEnd').addEventListener('change', e => { if (e.target.value) { e.target.blur(); winPatch('end', e.target)(); } });
  $('#todoRemOn').addEventListener('change', e => patch({ todoRemind: { enabled: e.target.checked } }));
  $('#todoRemBefore').addEventListener('change', e => patch({ todoRemind: { before: Number(e.target.value) } }));
  $('#todoShowDesk').addEventListener('click', async () => { const r = await api.showTodos(); if (r && !r.ok) toast('A check-in is on screen right now. Try again after answering it.', true); });
  $('#todoClear').addEventListener('click', async () => { const r = await todoCall(() => api.todoClearDone()); if (r) toast(r.cleared ? `Cleared ${r.cleared} completed.` : 'Nothing to clear.'); });
  $('#startAtLogin').addEventListener('change', e => patch({ startAtLogin: e.target.checked }));
  for (const r of $$('input[name="leave"]')) r.addEventListener('change', () => { if (r.checked) patch({ behavior: { leave: r.value } }); });
  $('#leaveSecs').addEventListener('input', debounce(e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 1) patch({ behavior: { leaveSecs: n } }); }, 500));
  $('#parkedOn').addEventListener('change', e => patch({ behavior: { parked: e.target.checked } }));
  $('#forgetSpot').addEventListener('click', () => patch({ behavior: { spot: null } }));
  $('#uninstall').addEventListener('click', async () => {
    try { const r = await api.uninstall(); if (r && r.cancelled) toast('Nothing was removed.'); } catch (e) { toast('Could not start the removal.', true); }
  });
  $('#askNow').addEventListener('click', async () => { const t = await api.askNow(); toast(t.ok ? 'Here I come!' : 'A check-in is already on screen. Answer it first.', !t.ok); });
  $('#openLog').addEventListener('click', () => api.openLog());
  document.addEventListener('click', async e => {
    const a = e.target.closest('a[data-link]'); if (!a) return;
    e.preventDefault();
    try { const r = await api.openLink(a.dataset.link); if (!r.ok) toast('Could not open that link.', true); } catch (err) { toast('Could not open that link.', true); }
  });

  api.onState(v => { V = v; render(); });
  api.onNotice(m => toast(m, true));
  api.onNavigate(t => { if (t === 'reminders-add') { showTab('reminders'); $('#remTitle').focus(); } else if (t === 'todos' && !(V && V.features && V.features.todos)) showTab('general'); else if (t) showTab(t); });

  buildDays(); defaultOnce(); showKind('once');
  api.getState().then(v => { V = v; render(); }).catch(() => toast('Could not load settings.', true));
  setInterval(() => { if (V) { V.now = Date.now(); renderReminders(); } }, 30000);   // keep "next: ..." and the Due badge fresh
})();
