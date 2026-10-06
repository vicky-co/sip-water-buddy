'use strict';
// Shared logic for the main process, the tests and the preview: settings validation, migration from older
// versions, and reminder scheduling. It uses no Electron or Node APIs, so it behaves the same everywhere.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SipCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SPEEDS = [0.6, 1, 1.5, 2.2];
  const SHOW = ['both', 'hero', 'pet'];                 // who is visible; 'hero' = pet hidden, 'pet' = hero hidden
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
    water: { enabled: true, interval: 30, goal: 8 },
    hero: { name: 'Hero', look: 'default' },
    pet: { name: 'Buddy', look: 'golden', flip: false, sound: 'bigdog', speed: 1 },
    show: 'both',
    sound: { mute: false, voice: true, pet: true, fx: true, volume: 0.6 },
    startAtLogin: true,
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
    if (state.water.enabled && waterNextAt != null && now >= waterNextAt) return { type: 'water' };
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
    if (info.type === 'water') return now + clampInt(info.minutes, 1, 720, state.water.interval) * 60000;
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
    if ('goal' in w) { const n = clampInt(w.goal, 1, 30, NaN); Number.isFinite(n) ? set(s.water, 'goal', n, 'water.goal') : rejected.push('water.goal'); }
    return { changed, rejected };
  }

  return { DEFAULTS, SPEEDS, SHOW, PET_LOOKS, PET_SOUNDS, KINDS, MAX_REMINDERS, DAY_NAMES, FILE,
    cleanText, clampInt, isHeroLook, isPetLook, isPetSound, parseDate, atLocal, todayStr, nextDue,
    makeReminder, updateReminder, afterAction, catchUp, isDue, describe, pickNext, nextEvent, applyFinish,
    normalize, applyPatch };
});
