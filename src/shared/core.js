'use strict';
// Shared logic for the main process, the tests and the preview: settings validation, migration from older
// versions, and reminder scheduling. It uses no Electron or Node APIs, so it behaves the same everywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SipCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SPEEDS = [0.6, 1, 1.5, 2.2];
  const SHOW = ['both', 'hero', 'pet'];                 // who is visible; 'hero' = pet hidden, 'pet' = hero hidden
  const LEAVE = ['instant', 'quick', 'normal', 'custom'];   // how long Sip lingers after you answer
  const PET_LOOKS = ['2d', 'golden', 'gsd'];
  const PET_SOUNDS = ['synth', 'bigdog', 'excited', 'pug', 'woofs'];
  const KINDS = ['once', 'daily', 'weekly', 'interval'];
  const NAME = '[\\p{L}\\p{M}\\p{N} ._()\\-]{1,100}';
  const FILE = {
    avatar: new RegExp('^file:' + NAME + '\\.glb$', 'iu'),
    pet: new RegExp('^file:' + NAME + '\\.glb$', 'iu'),
    sound: new RegExp('^file:' + NAME + '\\.(mp3|wav|ogg)$', 'iu'),
  };
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MAX_REMINDERS = 100;
  const MAX_TODOS = 200, MAX_HISTORY = 120;
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return (v !== null && v !== '' && Number.isFinite(n)) ? Math.min(hi, Math.max(lo, n)) : d; };
  // Plain text only: control characters and angle brackets are dropped, whitespace is tidied, length is capped.
  const cleanText = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const isHeroLook = v => v === 'default' || v === '2d' || (typeof v === 'string' && FILE.avatar.test(v));
  const isPetLook = v => PET_LOOKS.includes(v) || (typeof v === 'string' && FILE.pet.test(v));
  const isPetSound = v => PET_SOUNDS.includes(v) || (typeof v === 'string' && FILE.sound.test(v));
  const clone = v => JSON.parse(JSON.stringify(v));

  const DEFAULTS = {
    v: 2, date: '', count: 0, log: [],
    water: { enabled: true, interval: 30, goal: 8, window: { enabled: false, start: '08:00', end: '22:00' } },   // window: only ask between start and end
    hero: { name: 'Hero', look: 'default' },
    pet: { name: 'Buddy', look: 'golden', flip: false, sound: 'bigdog', speed: 1 },
    show: 'both',
    sound: { mute: false, voice: true, pet: true, fx: true, volume: 0.6 },
    startAtLogin: true,
    features: { todos: true },                                  // the to-do list can be switched off in Settings
    todos: [],                                                  // { id, text, done, createdAt, doneAt }
    history: [],                                                // one finished day each: { d: 'YYYY-MM-DD', n: glasses, goal, skips, skipMin, snoozes, snoozeMin }
    today: { skips: 0, skipMin: 0, snoozes: 0, snoozeMin: 0 }, // skipped / snoozed water check-ins so far today
    behavior: { leave: 'normal', leaveSecs: 8, parked: false, spot: null },   // spot: where to wait (screen coordinates of the feet), used when parked
    reminders: [],
  };

  // ---------- Dates and times (all local time) ----------
  function parseDate(s) {
    const m = typeof s === 'string' && DATE_RE.exec(s); if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
    return (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) ? { y, mo, d } : null;
  }
  function atLocal(dateStr, timeStr) {
    const p = parseDate(dateStr), t = TIME_RE.exec(timeStr); if (!p || !t) return null;
    return new Date(p.y, p.mo - 1, p.d, +t[1], +t[2], 0, 0).getTime();
  }
  const todayStr = (now = Date.now()) => new Date(now).toDateString();

  // Next time this reminder is due, strictly after `from` for repeating ones. For 'once' it is simply its date and time.
  function nextDue(r, from) {
    if (r.kind === 'once') return atLocal(r.date, r.at);
    if (r.kind === 'interval') return from + r.every * 60000;
    const days = r.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : r.days;
    const t = TIME_RE.exec(r.at); if (!t || !days || !days.length) return null;
    const b = new Date(from);
    for (let i = 0; i <= 8; i++) {
      const d = new Date(b.getFullYear(), b.getMonth(), b.getDate() + i, +t[1], +t[2], 0, 0);
      if (days.includes(d.getDay()) && d.getTime() > from) return d.getTime();
    }
    return null;
  }

  // ---------- Days, history and the 30-day statistics ----------
  const p2 = n => String(n).padStart(2, '0');
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const emptyToday = () => ({ skips: 0, skipMin: 0, snoozes: 0, snoozeMin: 0 });
  const cleanToday = t => { t = obj(t); return { skips: clampInt(t.skips, 0, 999, 0), skipMin: clampInt(t.skipMin, 0, 99999, 0), snoozes: clampInt(t.snoozes, 0, 999, 0), snoozeMin: clampInt(t.snoozeMin, 0, 99999, 0) }; };
  function cleanDay(h) {
    h = obj(h); if (typeof h.d !== 'string' || !DAY_KEY.test(h.d)) return null;
    const t = cleanToday(h);
    return Object.assign({ d: h.d, n: clampInt(h.n, 0, 999, 0), goal: clampInt(h.goal, 1, 30, 8) }, t);
  }
  // A new day has started: the day that just ended is filed in the history and today's counters start again.
  function rollover(s, now = Date.now()) {
    const t = todayStr(now); if (s.date === t) return false;
    const old = s.date ? new Date(s.date) : null;
    if (old && !isNaN(old.getTime()) && (s.water.enabled || s.count > 0 || s.today.skips > 0 || s.today.snoozes > 0)) {
      const rec = cleanDay(Object.assign({ d: dayKey(old.getTime()), n: s.count, goal: s.water.goal }, s.today));
      s.history = s.history.filter(x => x.d !== rec.d).concat(rec).sort((a, b) => a.d < b.d ? -1 : 1).slice(-MAX_HISTORY);
    }
    s.date = t; s.count = 0; s.log = []; s.today = emptyToday();
    return true;
  }
  // The last n days (oldest first). Days when Sip was not running have has:false. deviation = glasses minus that day's goal.
  function stats(s, now = Date.now(), n = 30) {
    const byDay = new Map(s.history.map(h => [h.d, h]));
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(now); dt.setDate(dt.getDate() - i);
      const d = dayKey(dt.getTime());
      const h = i === 0 ? Object.assign({ d, n: s.count, goal: s.water.goal }, s.today) : byDay.get(d);
      days.push(h ? { d, has: true, n: h.n, goal: h.goal, deviation: h.n - h.goal, skips: h.skips, skipMin: h.skipMin, snoozes: h.snoozes, snoozeMin: h.snoozeMin }
                  : { d, has: false, n: 0, goal: s.water.goal, deviation: 0, skips: 0, skipMin: 0, snoozes: 0, snoozeMin: 0 });
    }
    const t = days.filter(x => x.has), sum = k => t.reduce((a, x) => a + x[k], 0), r1 = v => Math.round(v * 10) / 10;
    return { days, totals: {
      trackedDays: t.length, glasses: sum('n'), avgPerDay: t.length ? r1(sum('n') / t.length) : 0,
      goalDays: t.filter(x => x.n >= x.goal).length, avgDeviation: t.length ? r1(sum('deviation') / t.length) : 0, totalDeviation: sum('deviation'),
      skips: sum('skips'), skipMin: sum('skipMin'), snoozes: sum('snoozes'), snoozeMin: sum('snoozeMin') } };
  }

  // ---------- To-do list ----------
  // A deadline is optional: 'YYYY-MM-DD' (due by the end of that day) or 'YYYY-MM-DDTHH:MM'.
  const DUE_RE = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;
  function cleanDue(v) {
    if (typeof v !== 'string') return null;
    const m = DUE_RE.exec(v); if (!m || !parseDate(m[1])) return null;
    return (!m[2] || TIME_RE.test(m[2])) ? v : null;
  }
  const dueAt = due => { const m = typeof due === 'string' && DUE_RE.exec(due); if (!m) return null; return m[2] ? atLocal(m[1], m[2]) : atLocal(m[1], '23:59') + 59999; };
  const isOverdue = (t, now) => !t.done && !!t.due && dueAt(t.due) != null && dueAt(t.due) < now;
  const cleanTodo = t => {
    t = obj(t); const text = cleanText(t.text, 120); if (!text) return null;
    return { id: (typeof t.id === 'string' && /^[\w-]{6,40}$/.test(t.id)) ? t.id : null, text, done: t.done === true,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0, doneAt: t.done === true && Number.isFinite(t.doneAt) ? t.doneAt : null, due: cleanDue(t.due) };
  };
  function addTodo(s, text, now, id, due) {
    const clean = cleanText(text, 120);
    if (!clean) return fail('Type what you need to do.');
    if (s.todos.length >= MAX_TODOS) return fail('The list is full (' + MAX_TODOS + '). Clear some finished ones first.');
    const hasDue = due !== undefined && due !== null && due !== '';
    if (hasDue && !cleanDue(due)) return fail('Pick a valid deadline.');
    const todo = { id, text: clean, done: false, createdAt: now, doneAt: null, due: hasDue ? due : null };
    s.todos.push(todo); return { ok: true, todo };
  }
  function setTodoDone(s, id, done, now) {
    const t = s.todos.find(x => x.id === id); if (!t) return fail('That item is gone.');
    t.done = done === true; t.doneAt = t.done ? now : null; return { ok: true, todo: t };
  }
  function setTodoDue(s, id, due) {
    const t = s.todos.find(x => x.id === id); if (!t) return fail('That item is gone.');
    if (due === undefined || due === null || due === '') { t.due = null; return { ok: true, todo: t }; }
    if (!cleanDue(due)) return fail('Pick a valid deadline.');
    t.due = due; return { ok: true, todo: t };
  }
  function deleteTodo(s, id) { const n = s.todos.length; s.todos = s.todos.filter(x => x.id !== id); return n !== s.todos.length; }
  function clearDoneTodos(s) { const n = s.todos.length; s.todos = s.todos.filter(x => !x.done); return n - s.todos.length; }

  // ---------- Water: only ask inside a window of the day ----------
  const isTime = v => typeof v === 'string' && TIME_RE.test(v);
  const toMin = hm => { const m = TIME_RE.exec(hm); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function cleanWindow(w) {
    w = obj(w); const d = DEFAULTS.water.window;
    const start = isTime(w.start) ? w.start : d.start, end = isTime(w.end) ? w.end : d.end;
    return start === end ? { enabled: false, start: d.start, end: d.end } : { enabled: w.enabled === true, start, end };
  }
  // The window may run past midnight (22:00 to 06:00). The start is included, the end is not.
  function inWaterWindow(w, ts) {
    if (!w || !w.enabled) return true;
    const d = new Date(ts), m = d.getHours() * 60 + d.getMinutes(), a = toMin(w.start), b = toMin(w.end);
    return a < b ? (m >= a && m < b) : (m >= a || m < b);
  }
  // The next time the window opens, strictly after ts.
  function nextWaterStart(w, ts) {
    const a = toMin(w.start), d = new Date(ts);
    let t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(a / 60), a % 60, 0, 0).getTime();
    if (t <= ts) { const n = new Date(t); n.setDate(n.getDate() + 1); t = n.getTime(); }
    return t;
  }
  // Where the next water ask may really land: inside the window. Called every minute, so it is also what "resets" the asks
  // when the window closes (the next one becomes the opening time) and what follows the window when the person edits it.
  function gateWater(state, nextAt, now) {
    const w = state.water.window; if (!state.water.enabled || !w.enabled || nextAt == null) return nextAt;
    if (!inWaterWindow(w, now)) { const open = nextWaterStart(w, now); return nextAt < open ? open : (inWaterWindow(w, nextAt) ? nextAt : nextWaterStart(w, nextAt)); }
    return inWaterWindow(w, nextAt) ? nextAt : nextWaterStart(w, nextAt);
  }
  // The person changed the window (or it was switched off). If the asks had been pushed out to the next opening and the window now
  // covers this moment (start moved earlier, end moved later, or the window was turned off), they resume instead of staying quiet.
  function rescheduleWater(state, nextAt, now) {
    const w = state.water.window, cycle = state.water.interval * 60000;
    let base = nextAt == null ? now + cycle : nextAt;
    if (base > now + cycle) base = now + (w.enabled ? 60000 : cycle);
    return gateWater(state, base, now);
  }

  // ---------- Reminders ----------
  // Reads the schedule fields for r.kind from src into r, validates them, and works out nextAt. Returns an error string or null.
  function applySchedule(r, src, now, isNew) {
    switch (r.kind) {
      case 'once': {
        if (!parseDate(src.date)) return 'Pick a valid date.';
        if (!TIME_RE.test(src.at)) return 'Pick a valid time.';
        r.date = src.date; r.at = src.at;
        const t = atLocal(r.date, r.at);
        if (isNew && t < now - 60000) return 'That time has already passed.';
        r.nextAt = t; return null;
      }
      case 'daily': {
        if (!TIME_RE.test(src.at)) return 'Pick a valid time.';
        r.at = src.at; r.nextAt = nextDue(r, now); return null;
      }
      case 'weekly': {
        const days = Array.isArray(src.days) ? [...new Set(src.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
        if (!days.length) return 'Pick at least one day.';
        if (!TIME_RE.test(src.at)) return 'Pick a valid time.';
        r.days = days; r.at = src.at; r.nextAt = nextDue(r, now); return null;
      }
      case 'interval': {
        const every = clampInt(src.every, 1, 10080, NaN);
        if (!Number.isFinite(every)) return 'Enter how often (in minutes).';
        r.every = every; r.nextAt = nextDue(r, now); return null;
      }
      default: return 'Pick when it should remind you.';
    }
  }
  const scheduleOf = r => ({ kind: r.kind, date: r.date, at: r.at, days: r.days, every: r.every });
  const fail = error => ({ ok: false, error });

  function makeReminder(input, now, id) {
    input = obj(input);
    const title = cleanText(input.title, 60);
    if (!title) return fail('Type what you want to be reminded about.');
    if (!KINDS.includes(input.kind)) return fail('Pick when it should remind you.');
    const r = { id, title, note: cleanText(input.note, 140), kind: input.kind, enabled: true, done: false, nextAt: null, lastDone: null, createdAt: now };
    const err = applySchedule(r, input, now, true);
    return err ? fail(err) : { ok: true, reminder: r };
  }

  function updateReminder(r, patch, now) {
    patch = obj(patch);
    const next = clone(r);
    if ('title' in patch) { const t = cleanText(patch.title, 60); if (!t) return fail('Type what you want to be reminded about.'); next.title = t; }
    if ('note' in patch) next.note = cleanText(patch.note, 140);
    const scheduleChanged = ['kind', 'date', 'at', 'days', 'every'].some(k => k in patch);
    if (scheduleChanged) {
      const kind = 'kind' in patch ? patch.kind : r.kind;
      if (!KINDS.includes(kind)) return fail('Pick when it should remind you.');
      const fresh = { id: r.id, title: next.title, note: next.note, kind, enabled: next.enabled, done: false, nextAt: null, lastDone: r.lastDone, createdAt: r.createdAt };
      const err = applySchedule(fresh, Object.assign(scheduleOf(r), patch), now, true);
      if (err) return fail(err);
      return finishUpdate(fresh, patch);
    }
    return finishUpdate(next, patch, now);
  }
  function finishUpdate(next, patch, now) {
    if ('enabled' in patch) {
      next.enabled = !!patch.enabled;
      if (next.enabled) {
        if (next.done) { next.done = false; next.nextAt = null; }
        if (next.kind === 'once') {
          const t = atLocal(next.date, next.at);
          if (t < (now || Date.now()) - 60000) { return fail('That time has already passed. Change the date or time first.'); }
          next.nextAt = t;
        } else if (next.nextAt == null || next.nextAt < (now || Date.now())) next.nextAt = nextDue(next, now || Date.now());
      }
    }
    return { ok: true, reminder: next };
  }

  const isDue = (r, now) => r.enabled && !r.done && r.nextAt != null && r.nextAt <= now;

  // What happens when the person answers a reminder: 'done', 'skip' or 'snooze' (minutes).
  function afterAction(r, action, now, minutes) {
    if (action === 'snooze') { r.nextAt = now + clampInt(minutes, 1, 1440, 10) * 60000; return r; }
    if (action === 'done') r.lastDone = now;
    if (r.kind === 'once') { r.done = true; r.nextAt = null; }
    else r.nextAt = nextDue(r, now);
    return r;
  }

  // At startup: a repeating reminder that was due long ago just moves to its next time instead of firing for something stale.
  function catchUp(state, now) {
    for (const r of state.reminders) {
      if (!r.enabled || r.done || r.nextAt == null || r.nextAt > now) continue;
      if (r.kind !== 'once' && now - r.nextAt > 6 * 3600000) r.nextAt = nextDue(r, now);
    }
  }

  function describe(r) {
    switch (r.kind) {
      case 'once': return 'Once, ' + r.date + ' at ' + r.at;
      case 'daily': return 'Every day at ' + r.at;
      case 'weekly': {
        const d = r.days || [], key = d.join(',');
        const label = key === '1,2,3,4,5' ? 'Weekdays' : key === '0,6' ? 'Weekends' : d.map(i => DAY_NAMES[i]).join(', ');
        return label + ' at ' + r.at;
      }
      case 'interval': return r.every % 60 === 0 ? 'Every ' + (r.every / 60) + (r.every === 60 ? ' hour' : ' hours') : 'Every ' + r.every + ' minutes';
      default: return '';
    }
  }

  // ---------- Which check-in comes next ----------
  function pickNext(state, waterNextAt, now) {
    const due = state.reminders.filter(r => isDue(r, now)).sort((a, b) => a.nextAt - b.nextAt);
    if (due.length) return { type: 'reminder', id: due[0].id };
    if (state.water.enabled && waterNextAt != null && now >= waterNextAt && inWaterWindow(state.water.window, now)) return { type: 'water' };
    return null;
  }
  function nextEvent(state, waterNextAt) {
    let best = null;
    if (state.water.enabled && waterNextAt != null) best = { label: 'Water', at: waterNextAt };
    for (const r of state.reminders) if (r.enabled && !r.done && r.nextAt != null && (!best || r.nextAt < best.at)) best = { label: r.title, at: r.nextAt };
    return best;
  }
  // Applies the answer from the character window. Returns the new waterNextAt.
  function applyFinish(state, info, now, waterNextAt) {
    info = obj(info);
    if (info.preview) return waterNextAt;
    if (info.type === 'water') {
      const mins = clampInt(info.minutes, 1, 720, state.water.interval);
      if (info.action === 'skip') { state.today.skips += 1; state.today.skipMin += mins; }
      else if (info.action === 'snooze') { state.today.snoozes += 1; state.today.snoozeMin += mins; }
      return now + mins * 60000;
    }
    if (info.type === 'reminder') {
      const r = state.reminders.find(x => x.id === info.id);
      if (r && ['done', 'skip', 'snooze'].includes(info.action)) afterAction(r, info.action, now, info.minutes);
    }
    return waterNextAt;
  }

  // ---------- Settings ----------
  function cleanReminder(r, now) {
    r = obj(r);
    const title = cleanText(r.title, 60); if (!title || !KINDS.includes(r.kind)) return null;
    const out = { id: (typeof r.id === 'string' && /^[\w-]{6,40}$/.test(r.id)) ? r.id : null, title, note: cleanText(r.note, 140), kind: r.kind,
      enabled: r.enabled !== false, done: r.done === true, nextAt: Number.isFinite(r.nextAt) ? r.nextAt : null,
      lastDone: Number.isFinite(r.lastDone) ? r.lastDone : null, createdAt: Number.isFinite(r.createdAt) ? r.createdAt : now };
    const probe = {}; let err;
    err = applySchedule(Object.assign(probe, { kind: r.kind }), r, now, false);
    if (err) return null;
    for (const k of ['date', 'at', 'days', 'every']) if (probe[k] !== undefined) out[k] = probe[k];
    if (!out.done && out.enabled && out.nextAt == null) out.nextAt = probe.nextAt;
    return out;
  }

  // A waiting spot is a point on the desktop; anything that is not two sane whole numbers is dropped.
  const cleanSpot = v => { v = obj(v); const x = clampInt(v.x, -100000, 100000, NaN), y = clampInt(v.y, -100000, 100000, NaN); return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null; };

  function normalize(raw, now = Date.now(), newId = () => Math.random().toString(36).slice(2, 12)) {
    raw = obj(raw);
    const old = raw.v === undefined && Object.keys(raw).length > 0;     // a file written by version 1
    const s = clone(DEFAULTS);
    s.date = typeof raw.date === 'string' ? raw.date.slice(0, 40) : '';
    s.count = clampInt(raw.count, 0, 999, 0);
    s.log = Array.isArray(raw.log) ? raw.log.filter(Number.isFinite).slice(-200) : [];
    const w = obj(raw.water);
    s.water.enabled = typeof w.enabled === 'boolean' ? w.enabled : true;
    s.water.interval = clampInt(w.interval !== undefined ? w.interval : raw.interval, 1, 720, 30);
    s.water.goal = clampInt(w.goal !== undefined ? w.goal : raw.goal, 1, 30, 8);
    s.water.window = cleanWindow(w.window);
    const h = obj(raw.hero);
    s.hero.name = cleanText(h.name, 24) || 'Hero';
    const hl = h.look !== undefined ? h.look : (raw.avatar === '3d' ? 'default' : raw.avatar);
    s.hero.look = isHeroLook(hl) ? hl : 'default';
    const p = obj(raw.pet);
    s.pet.name = cleanText(p.name, 24) || (old ? 'Bruno' : 'Buddy');   // people upgrading from version 1 keep the name they saw
    const pl = p.look !== undefined ? p.look : raw.dogLook;
    s.pet.look = isPetLook(pl) ? pl : 'golden';
    s.pet.flip = typeof p.flip === 'boolean' ? p.flip : raw.dogFlip === true;
    const ps = p.sound !== undefined ? p.sound : raw.bark;
    s.pet.sound = isPetSound(ps) ? ps : 'bigdog';
    const sp = Number(p.speed !== undefined ? p.speed : raw.dogSpeed);
    s.pet.speed = SPEEDS.includes(sp) ? sp : 1;
    s.show = SHOW.includes(raw.show) ? raw.show : (raw.dog === false ? 'hero' : 'both');
    const so = obj(raw.sound);
    for (const k of ['mute', 'voice', 'fx']) if (typeof so[k] === 'boolean') s.sound[k] = so[k];
    const petSnd = so.pet !== undefined ? so.pet : so.dog;
    if (typeof petSnd === 'boolean') s.sound.pet = petSnd;
    if (typeof so.volume === 'number' && so.volume >= 0 && so.volume <= 1) s.sound.volume = Math.round(so.volume * 100) / 100;
    s.startAtLogin = typeof raw.startAtLogin === 'boolean' ? raw.startAtLogin : raw.loginWanted !== false;
    const b = obj(raw.behavior);
    s.behavior.leave = LEAVE.includes(b.leave) ? b.leave : 'normal';
    s.behavior.leaveSecs = clampInt(b.leaveSecs, 1, 60, 8);
    s.behavior.spot = cleanSpot(b.spot);
    s.behavior.parked = b.parked === true && !!s.behavior.spot;
    s.features.todos = obj(raw.features).todos !== false;
    const seenT = new Set();
    for (const tt of (Array.isArray(raw.todos) ? raw.todos : []).slice(0, MAX_TODOS)) {
      const c = cleanTodo(tt); if (!c) continue;
      if (!c.id || seenT.has(c.id)) c.id = newId();
      seenT.add(c.id); s.todos.push(c);
    }
    const days = new Map();
    for (const hh of (Array.isArray(raw.history) ? raw.history : []).slice(-MAX_HISTORY * 2)) { const c = cleanDay(hh); if (c) days.set(c.d, c); }
    s.history = [...days.values()].sort((a, b) => a.d < b.d ? -1 : 1).slice(-MAX_HISTORY);
    s.today = cleanToday(raw.today);
    const seen = new Set();
    for (const rr of (Array.isArray(raw.reminders) ? raw.reminders : []).slice(0, MAX_REMINDERS)) {
      const c = cleanReminder(rr, now); if (!c) continue;
      if (!c.id || seen.has(c.id)) c.id = newId();
      seen.add(c.id); s.reminders.push(c);
    }
    return s;
  }

  // Applies a patch from the settings window. Every field is checked; anything invalid is ignored and reported.
  function applyPatch(s, patch) {
    const changed = [], rejected = [];
    const set = (o, k, v, path) => { if (o[k] !== v) { o[k] = v; changed.push(path); } };
    patch = obj(patch);
    if ('show' in patch) SHOW.includes(patch.show) ? set(s, 'show', patch.show, 'show') : rejected.push('show');
    if ('startAtLogin' in patch) typeof patch.startAtLogin === 'boolean' ? set(s, 'startAtLogin', patch.startAtLogin, 'startAtLogin') : rejected.push('startAtLogin');
    const h = obj(patch.hero);
    if ('name' in h) { const n = cleanText(h.name, 24); n ? set(s.hero, 'name', n, 'hero.name') : rejected.push('hero.name'); }
    if ('look' in h) isHeroLook(h.look) ? set(s.hero, 'look', h.look, 'hero.look') : rejected.push('hero.look');
    const p = obj(patch.pet);
    if ('name' in p) { const n = cleanText(p.name, 24); n ? set(s.pet, 'name', n, 'pet.name') : rejected.push('pet.name'); }
    if ('look' in p) isPetLook(p.look) ? set(s.pet, 'look', p.look, 'pet.look') : rejected.push('pet.look');
    if ('sound' in p) isPetSound(p.sound) ? set(s.pet, 'sound', p.sound, 'pet.sound') : rejected.push('pet.sound');
    if ('flip' in p) typeof p.flip === 'boolean' ? set(s.pet, 'flip', p.flip, 'pet.flip') : rejected.push('pet.flip');
    if ('speed' in p) SPEEDS.includes(Number(p.speed)) ? set(s.pet, 'speed', Number(p.speed), 'pet.speed') : rejected.push('pet.speed');
    const so = obj(patch.sound);
    for (const k of ['mute', 'voice', 'pet', 'fx']) if (k in so) typeof so[k] === 'boolean' ? set(s.sound, k, so[k], 'sound.' + k) : rejected.push('sound.' + k);
    if ('volume' in so) (typeof so.volume === 'number' && so.volume >= 0 && so.volume <= 1) ? set(s.sound, 'volume', Math.round(so.volume * 100) / 100, 'sound.volume') : rejected.push('sound.volume');
    const w = obj(patch.water);
    if ('enabled' in w) typeof w.enabled === 'boolean' ? set(s.water, 'enabled', w.enabled, 'water.enabled') : rejected.push('water.enabled');
    if ('interval' in w) { const n = clampInt(w.interval, 1, 720, NaN); Number.isFinite(n) ? set(s.water, 'interval', n, 'water.interval') : rejected.push('water.interval'); }
    if ('window' in w) {
      const ww = obj(w.window), cur = s.water.window, next = { enabled: cur.enabled, start: cur.start, end: cur.end };
      let bad = false;
      if ('enabled' in ww) typeof ww.enabled === 'boolean' ? next.enabled = ww.enabled : bad = true;
      if ('start' in ww) isTime(ww.start) ? next.start = ww.start : bad = true;
      if ('end' in ww) isTime(ww.end) ? next.end = ww.end : bad = true;
      if (next.start === next.end) bad = true;                                       // an empty window would never ask
      if (bad) rejected.push('water.window');
      else for (const k of ['enabled', 'start', 'end']) set(cur, k, next[k], 'water.window.' + k);
    }
    if ('goal' in w) { const n = clampInt(w.goal, 1, 30, NaN); Number.isFinite(n) ? set(s.water, 'goal', n, 'water.goal') : rejected.push('water.goal'); }
    const ft = obj(patch.features);
    if ('todos' in ft) typeof ft.todos === 'boolean' ? set(s.features, 'todos', ft.todos, 'features.todos') : rejected.push('features.todos');
    const bh = obj(patch.behavior);
    if ('leave' in bh) LEAVE.includes(bh.leave) ? set(s.behavior, 'leave', bh.leave, 'behavior.leave') : rejected.push('behavior.leave');
    if ('leaveSecs' in bh) { const n = clampInt(bh.leaveSecs, 1, 60, NaN); Number.isFinite(n) ? set(s.behavior, 'leaveSecs', n, 'behavior.leaveSecs') : rejected.push('behavior.leaveSecs'); }
    if ('spot' in bh) {
      const sp = bh.spot === null ? null : cleanSpot(bh.spot);
      if (bh.spot !== null && !sp) rejected.push('behavior.spot');
      else if (JSON.stringify(s.behavior.spot) !== JSON.stringify(sp)) { s.behavior.spot = sp; if (!sp) s.behavior.parked = false; changed.push('behavior.spot'); }
    }
    if ('parked' in bh) {
      if (typeof bh.parked !== 'boolean') rejected.push('behavior.parked');
      else if (bh.parked && !s.behavior.spot) rejected.push('behavior.parked');       // nothing to wait at yet
      else set(s.behavior, 'parked', bh.parked, 'behavior.parked');
    }
    return { changed, rejected };
  }

  return { LEAVE, DEFAULTS, SPEEDS, SHOW, PET_LOOKS, PET_SOUNDS, KINDS, MAX_REMINDERS, DAY_NAMES, FILE,
    cleanText, clampInt, isHeroLook, isPetLook, isPetSound, parseDate, atLocal, todayStr, nextDue,
    makeReminder, updateReminder, afterAction, catchUp, isDue, describe, pickNext, nextEvent, applyFinish,
    normalize, applyPatch, cleanDue, dueAt, isOverdue, setTodoDue, inWaterWindow, nextWaterStart, gateWater, rescheduleWater, rollover, stats, dayKey, MAX_TODOS, addTodo, setTodoDone, deleteTodo, clearDoneTodos };
});
