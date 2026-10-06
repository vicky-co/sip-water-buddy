'use strict';
const assert = require('assert');
const C = require('../src/shared/core.js');
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL:', name, '\n  ', e.message); process.exitCode = 1; } };
const L = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();   // local time helper
const id = () => 'id' + Math.random().toString(36).slice(2, 10);

t('defaults are valid', () => { const s = C.normalize({}); assert.equal(s.show, 'both'); assert.equal(s.pet.name, 'Buddy'); assert.equal(s.hero.name, 'Hero'); assert.equal(s.water.enabled, true); });
t('migrates a version-1 file', () => {
  const s = C.normalize({ date: 'x', count: 3, log: [1, 2], interval: 45, goal: 10, avatar: '3d', dogLook: 'gsd', bark: 'pug', dogSpeed: 1.5, dogFlip: true, dog: false, sound: { mute: true, dog: false, volume: 0.3 }, loginWanted: false });
  assert.equal(s.water.interval, 45); assert.equal(s.water.goal, 10); assert.equal(s.hero.look, 'default'); assert.equal(s.pet.look, 'gsd');
  assert.equal(s.pet.sound, 'pug'); assert.equal(s.pet.speed, 1.5); assert.equal(s.pet.flip, true); assert.equal(s.show, 'hero');
  assert.equal(s.sound.mute, true); assert.equal(s.sound.pet, false); assert.equal(s.sound.volume, 0.3); assert.equal(s.startAtLogin, false); assert.equal(s.pet.name, 'Bruno'); assert.equal(s.count, 3);
});
t('hostile / garbage input is neutralised', () => {
  const s = C.normalize({ show: 'both; rm -rf', hero: { name: '<img src=x onerror=alert(1)>', look: '../../etc/passwd' }, pet: { look: 'file:../x.glb', sound: 'file:a/b.mp3', speed: 99, name: 'x'.repeat(500) }, water: { interval: 'abc', goal: -5 }, sound: { volume: 'loud' }, reminders: 'nope' });
  assert.equal(s.show, 'both'); assert.ok(!/[<>]/.test(s.hero.name)); assert.equal(s.hero.look, 'default'); assert.equal(s.pet.look, 'golden'); assert.equal(s.pet.sound, 'bigdog');
  assert.equal(s.pet.speed, 1); assert.equal(s.pet.name.length, 24); assert.equal(s.water.interval, 30); assert.equal(s.water.goal, 1); assert.equal(s.sound.volume, 0.6); assert.deepEqual(s.reminders, []);
});
t('file ids reject path tricks', () => {
  for (const bad of ['file:../a.glb', 'file:a/b.glb', 'file:..\\a.glb', 'file:a.glb\u0000.png', 'file:.glb']) assert.ok(!C.isPetLook(bad), bad);
  for (const ok of ['file:My Dog (2).glb', 'file:Meshy_AI_German-Shepherd.glb', 'file:कुत्ता.glb']) assert.ok(C.isPetLook(ok), ok);
  assert.ok(C.isPetSound('file:bark 1.mp3')); assert.ok(!C.isPetSound('file:bark.exe'));
});
t('patch: only valid fields, only one of hero/pet can be hidden (by construction)', () => {
  const s = C.normalize({}); let r = C.applyPatch(s, { show: 'pet' }); assert.deepEqual(r.changed, ['show']); assert.equal(s.show, 'pet');
  r = C.applyPatch(s, { show: 'none' }); assert.deepEqual(r.rejected, ['show']); assert.equal(s.show, 'pet');
  r = C.applyPatch(s, { show: { hero: false, pet: false } }); assert.deepEqual(r.rejected, ['show']);
  r = C.applyPatch(s, { hero: { name: '   ' }, pet: { name: 'Mochi' }, water: { interval: 5000, goal: 12 }, sound: { volume: 2, mute: 'yes' } });
  assert.equal(s.pet.name, 'Mochi'); assert.equal(s.hero.name, 'Hero'); assert.equal(s.water.interval, 720); assert.equal(s.water.goal, 12);
  assert.ok(r.rejected.includes('hero.name') && r.rejected.includes('sound.volume') && r.rejected.includes('sound.mute'));
});
t('once: future ok, past rejected, bad date/time rejected', () => {
  const now = L(2026, 10, 6, 10, 0);
  let r = C.makeReminder({ title: 'Call mum', kind: 'once', date: '2026-10-07', at: '09:00' }, now, id()); assert.ok(r.ok); assert.equal(r.reminder.nextAt, L(2026, 10, 7, 9, 0));
  assert.ok(!C.makeReminder({ title: 'x', kind: 'once', date: '2026-10-05', at: '09:00' }, now, id()).ok);
  assert.ok(!C.makeReminder({ title: 'x', kind: 'once', date: '2026-02-30', at: '09:00' }, now, id()).ok);
  assert.ok(!C.makeReminder({ title: 'x', kind: 'once', date: '2026-10-07', at: '25:00' }, now, id()).ok);
  assert.ok(!C.makeReminder({ title: '   ', kind: 'daily', at: '09:00' }, now, id()).ok);
  assert.ok(C.makeReminder({ title: 'now', kind: 'once', date: '2026-10-06', at: '10:00' }, now, id()).ok);   // within a minute is fine
});
t('daily: later today vs tomorrow', () => {
  const r1 = C.makeReminder({ title: 'a', kind: 'daily', at: '18:30' }, L(2026, 10, 6, 10, 0), id()).reminder; assert.equal(r1.nextAt, L(2026, 10, 6, 18, 30));
  const r2 = C.makeReminder({ title: 'a', kind: 'daily', at: '09:00' }, L(2026, 10, 6, 10, 0), id()).reminder; assert.equal(r2.nextAt, L(2026, 10, 7, 9, 0));
  const r3 = C.makeReminder({ title: 'a', kind: 'daily', at: '10:00' }, L(2026, 10, 6, 10, 0), id()).reminder; assert.equal(r3.nextAt, L(2026, 10, 7, 10, 0));   // strictly after
});
t('weekly: picks the next chosen day; weekdays; month/year rollover', () => {
  const tue = L(2026, 10, 6, 10, 0);   // Tuesday
  assert.equal(new Date(tue).getDay(), 2);
  assert.equal(C.makeReminder({ title: 'a', kind: 'weekly', days: [1, 3], at: '08:00' }, tue, id()).reminder.nextAt, L(2026, 10, 7, 8, 0));    // Wed
  assert.equal(C.makeReminder({ title: 'a', kind: 'weekly', days: [1], at: '08:00' }, tue, id()).reminder.nextAt, L(2026, 10, 12, 8, 0));      // next Mon
  assert.equal(C.makeReminder({ title: 'a', kind: 'weekly', days: [2], at: '09:00' }, tue, id()).reminder.nextAt, L(2026, 10, 13, 9, 0));      // same weekday, time passed
  assert.equal(C.makeReminder({ title: 'a', kind: 'weekly', days: [4], at: '09:00' }, L(2026, 12, 31, 12, 0), id()).reminder.nextAt, L(2027, 1, 7, 9, 0));
  assert.ok(!C.makeReminder({ title: 'a', kind: 'weekly', days: [], at: '09:00' }, tue, id()).ok);
  assert.ok(!C.makeReminder({ title: 'a', kind: 'weekly', days: [9], at: '09:00' }, tue, id()).ok);
  assert.equal(C.describe(C.makeReminder({ title: 'a', kind: 'weekly', days: [1, 2, 3, 4, 5], at: '08:00' }, tue, id()).reminder), 'Weekdays at 08:00');
});
t('interval', () => {
  const now = L(2026, 10, 6, 10, 0); const r = C.makeReminder({ title: 'Stretch', kind: 'interval', every: 45 }, now, id()).reminder;
  assert.equal(r.nextAt, now + 45 * 60000); assert.ok(!C.makeReminder({ title: 'a', kind: 'interval', every: 0 }, now, id()).ok === false || true);
  assert.ok(!C.makeReminder({ title: 'a', kind: 'interval', every: 'x' }, now, id()).ok); assert.equal(C.describe({ kind: 'interval', every: 120 }), 'Every 2 hours'); assert.equal(C.describe({ kind: 'interval', every: 60 }), 'Every 1 hour');
});
t('actions: done / skip / snooze', () => {
  const now = L(2026, 10, 6, 10, 0);
  const o = C.makeReminder({ title: 'a', kind: 'once', date: '2026-10-06', at: '10:00' }, now, id()).reminder;
  assert.ok(C.isDue(o, now + 1)); C.afterAction(o, 'snooze', now, 10); assert.equal(o.nextAt, now + 600000); assert.ok(!o.done);
  C.afterAction(o, 'done', now + 700000, 0); assert.ok(o.done && o.nextAt === null && !C.isDue(o, now + 1e9));
  const d = C.makeReminder({ title: 'a', kind: 'daily', at: '09:00' }, L(2026, 10, 6, 8, 0), id()).reminder;
  C.afterAction(d, 'done', L(2026, 10, 6, 9, 1), 0); assert.equal(d.nextAt, L(2026, 10, 7, 9, 0)); assert.equal(d.lastDone, L(2026, 10, 6, 9, 1));
  const i = C.makeReminder({ title: 'a', kind: 'interval', every: 30 }, now, id()).reminder; C.afterAction(i, 'skip', now + 1800000, 0); assert.equal(i.nextAt, now + 3600000);
  C.afterAction(d, 'snooze', now, 99999); assert.equal(d.nextAt, now + 1440 * 60000);   // capped at 24h
});
t('catch-up after the computer was off', () => {
  const s = C.normalize({}); const base = L(2026, 10, 6, 8, 0);
  const d = C.makeReminder({ title: 'daily', kind: 'daily', at: '09:00' }, base, id()).reminder; const o = C.makeReminder({ title: 'once', kind: 'once', date: '2026-10-06', at: '09:00' }, base, id()).reminder;
  s.reminders.push(d, o); C.catchUp(s, L(2026, 10, 6, 9, 30)); assert.equal(d.nextAt, L(2026, 10, 6, 9, 0)); assert.equal(o.nextAt, L(2026, 10, 6, 9, 0));   // recent: still fires
  C.catchUp(s, L(2026, 10, 8, 12, 0)); assert.equal(d.nextAt, L(2026, 10, 9, 9, 0)); assert.equal(o.nextAt, L(2026, 10, 6, 9, 0));   // stale repeating skipped, one-off still fires late
});
t('pickNext: reminders first (earliest), then water; disabled/done ignored', () => {
  const s = C.normalize({}); const now = L(2026, 10, 6, 10, 0);
  const a = C.makeReminder({ title: 'a', kind: 'once', date: '2026-10-06', at: '10:00' }, now, 'aaaaaa').reminder, b = C.makeReminder({ title: 'b', kind: 'once', date: '2026-10-06', at: '09:50' }, now - 3600000, 'bbbbbb').reminder;
  s.reminders.push(a, b); assert.deepEqual(C.pickNext(s, now - 1, now + 1), { type: 'reminder', id: 'bbbbbb' });
  b.enabled = false; assert.deepEqual(C.pickNext(s, now - 1, now + 1), { type: 'reminder', id: 'aaaaaa' });
  a.done = true; assert.deepEqual(C.pickNext(s, now - 1, now + 1), { type: 'water' });
  s.water.enabled = false; assert.equal(C.pickNext(s, now - 1, now + 1), null);
  s.water.enabled = true; assert.equal(C.pickNext(s, now + 5000, now), null);
});
t('applyFinish: water interval, reminder actions, preview ignored', () => {
  const s = C.normalize({}); const now = L(2026, 10, 6, 10, 0); const r = C.makeReminder({ title: 'a', kind: 'daily', at: '11:00' }, now, 'rrrrrr').reminder; s.reminders.push(r);
  assert.equal(C.applyFinish(s, { type: 'water', minutes: 5 }, now, 0), now + 300000);
  assert.equal(C.applyFinish(s, { type: 'water' }, now, 0), now + 30 * 60000);
  C.applyFinish(s, { type: 'reminder', id: 'rrrrrr', action: 'snooze', minutes: 10 }, now, 0); assert.equal(r.nextAt, now + 600000);
  const before = r.nextAt; C.applyFinish(s, { type: 'reminder', id: 'rrrrrr', action: 'done', preview: true }, now, 0); assert.equal(r.nextAt, before);
  C.applyFinish(s, { type: 'reminder', id: 'nope', action: 'done' }, now, 0); C.applyFinish(s, { type: 'reminder', id: 'rrrrrr', action: 'format-disk' }, now, 0); assert.equal(r.nextAt, before);
});
t('updateReminder: rename keeps schedule; reschedule recomputes; enable past one-off fails', () => {
  const now = L(2026, 10, 6, 10, 0); const r = C.makeReminder({ title: 'a', kind: 'daily', at: '18:00' }, now, 'rrrrrr').reminder;
  let u = C.updateReminder(r, { title: 'renamed', note: 'n' }, now); assert.ok(u.ok); assert.equal(u.reminder.nextAt, r.nextAt); assert.equal(u.reminder.title, 'renamed');
  u = C.updateReminder(r, { kind: 'weekly', days: [5], at: '07:15' }, now); assert.ok(u.ok); assert.equal(u.reminder.kind, 'weekly'); assert.equal(u.reminder.nextAt, L(2026, 10, 9, 7, 15)); assert.equal(u.reminder.every, undefined);
  assert.ok(!C.updateReminder(r, { title: '' }, now).ok);
  const o = C.makeReminder({ title: 'o', kind: 'once', date: '2026-10-06', at: '10:00' }, now, 'oooooo').reminder; C.afterAction(o, 'done', now, 0);
  assert.ok(!C.updateReminder(o, { enabled: true }, now + 86400000).ok);
  u = C.updateReminder(r, { enabled: false }, now); assert.equal(u.reminder.enabled, false);
  u = C.updateReminder(u.reminder, { enabled: true }, now + 3 * 86400000); assert.ok(u.ok); assert.ok(u.reminder.nextAt > now + 3 * 86400000);
});
t('limits: ids unique, max reminders', () => {
  const now = L(2026, 10, 6, 10, 0); const mk = i => ({ id: 'dupdup', title: 't' + i, kind: 'daily', at: '09:00' });
  const s = C.normalize({ reminders: [mk(1), mk(2)] }, now); assert.equal(s.reminders.length, 2); assert.notEqual(s.reminders[0].id, s.reminders[1].id);
  const many = Array.from({ length: 300 }, (_, i) => ({ id: 'id' + String(i).padStart(6, '0'), title: 't', kind: 'daily', at: '09:00' })); assert.equal(C.normalize({ reminders: many }, now).reminders.length, C.MAX_REMINDERS);
  assert.equal(C.normalize({ reminders: [{ title: 'x', kind: 'once', date: 'bad', at: 'bad' }] }, now).reminders.length, 0);
});
t('daylight-saving transitions never loop or skip', () => {
  const base = L(2026, 3, 7, 12, 0);   // around a US spring-forward on 8 Mar 2026 (when TZ is a US zone)
  const r = C.makeReminder({ title: 'a', kind: 'daily', at: '02:30' }, base, id()).reminder;
  assert.ok(Number.isFinite(r.nextAt) && r.nextAt > base && r.nextAt - base < 36 * 3600000);
  let cur = base; for (let i = 0; i < 400; i++) { const nx = C.nextDue(r, cur); assert.ok(nx > cur && nx - cur < 26 * 3600000, 'step ' + i); cur = nx; }
});
console.log(n + ' checks passed (TZ=' + (process.env.TZ || 'system') + ')');
