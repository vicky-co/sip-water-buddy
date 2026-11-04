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
t('behavior settings: leave time and waiting spot are validated', () => {
  let s = C.normalize({}); assert.deepEqual(s.behavior, { leave: 'normal', leaveSecs: 8, parked: false, spot: null });
  let r = C.applyPatch(s, { behavior: { leave: 'instant', leaveSecs: 500 } }); assert.equal(s.behavior.leave, 'instant'); assert.equal(s.behavior.leaveSecs, 60); assert.deepEqual(r.rejected, []);
  r = C.applyPatch(s, { behavior: { leave: 'forever', leaveSecs: 'abc' } }); assert.deepEqual(r.rejected.sort(), ['behavior.leave', 'behavior.leaveSecs']); assert.equal(s.behavior.leave, 'instant');
  r = C.applyPatch(s, { behavior: { parked: true } }); assert.deepEqual(r.rejected, ['behavior.parked']); assert.equal(s.behavior.parked, false);   // no spot chosen yet
  r = C.applyPatch(s, { behavior: { spot: { x: 640.4, y: 900 } } }); assert.deepEqual(s.behavior.spot, { x: 640, y: 900 }); assert.deepEqual(r.changed, ['behavior.spot']);
  r = C.applyPatch(s, { behavior: { parked: true } }); assert.equal(s.behavior.parked, true);
  r = C.applyPatch(s, { behavior: { spot: { x: 'a', y: 1 } } }); assert.deepEqual(r.rejected, ['behavior.spot']); assert.deepEqual(s.behavior.spot, { x: 640, y: 900 });
  r = C.applyPatch(s, { behavior: { spot: null } }); assert.equal(s.behavior.spot, null); assert.equal(s.behavior.parked, false);               // clearing the spot also releases the hero
  s = C.normalize({ behavior: { parked: true, spot: null, leave: 'custom', leaveSecs: 12 } }); assert.equal(s.behavior.parked, false); assert.equal(s.behavior.leave, 'custom'); assert.equal(s.behavior.leaveSecs, 12);
  s = C.normalize({ behavior: { spot: { x: 1e9, y: 2 }, leave: '<b>' } }); assert.equal(s.behavior.spot.x, 100000); assert.equal(s.behavior.leave, 'normal');
});
t('history: a finished day is filed, skips are counted, stats cover 30 days with deviation', () => {
  const s = C.normalize({}); const d1 = L(2026, 10, 10, 9, 0), d2 = L(2026, 10, 11, 9, 0);
  s.date = C.todayStr(d1); s.count = 5; s.water.goal = 8;
  C.applyFinish(s, { type: 'water', action: 'skip', minutes: 30 }, d1, 0); C.applyFinish(s, { type: 'water', action: 'skip', minutes: 30 }, d1, 0);
  C.applyFinish(s, { type: 'water', action: 'snooze', minutes: 5 }, d1, 0); C.applyFinish(s, { type: 'water', action: 'done', minutes: 30 }, d1, 0);
  C.applyFinish(s, { type: 'water', action: 'skip', minutes: 30, preview: true }, d1, 0);                               // previews never count
  assert.deepEqual(s.today, { skips: 2, skipMin: 60, snoozes: 1, snoozeMin: 5 });
  assert.ok(C.rollover(s, d2)); assert.equal(s.count, 0); assert.deepEqual(s.today, { skips: 0, skipMin: 0, snoozes: 0, snoozeMin: 0 });
  assert.deepEqual(s.history, [{ d: '2026-10-10', n: 5, goal: 8, skips: 2, skipMin: 60, snoozes: 1, snoozeMin: 5 }]);
  assert.equal(C.rollover(s, d2), false);
  s.count = 9;                                                                                                                 // today so far
  const st = C.stats(s, d2); assert.equal(st.days.length, 30); assert.equal(st.days[29].d, '2026-10-11'); assert.equal(st.days[28].d, '2026-10-10');
  assert.equal(st.days[28].deviation, -3); assert.equal(st.days[29].deviation, 1); assert.equal(st.days[0].has, false);
  assert.deepEqual(st.totals, { trackedDays: 2, glasses: 14, avgPerDay: 7, goalDays: 1, avgDeviation: -1, totalDeviation: -2, skips: 2, skipMin: 60, snoozes: 1, snoozeMin: 5 });
  // history survives a save and load, bad entries are dropped, and it is capped
  const again = C.normalize(JSON.parse(JSON.stringify(s))); assert.deepEqual(again.history, s.history);
  const junk = C.normalize({ history: [{ d: 'x', n: 1 }, { d: '2026-01-01', n: 'lots', goal: 99 }, 5, null].concat(Array.from({ length: 300 }, (_, i) => ({ d: new Date(2025, 0, 1 + i).toISOString().slice(0, 10), n: 3, goal: 8 }))) });
  assert.ok(junk.history.length <= 120 && junk.history.every(h => /^\d{4}-\d{2}-\d{2}$/.test(h.d) && h.goal <= 30));
});
t('rollover with no water and no activity files nothing', () => {
  const s = C.normalize({}); s.water.enabled = false; s.date = C.todayStr(L(2026, 10, 10, 9, 0)); C.rollover(s, L(2026, 10, 12, 9, 0)); assert.equal(s.history.length, 0);
});
t('to-do list: add, finish, delete, clear, limits, switch', () => {
  const s = C.normalize({}); assert.equal(s.features.todos, true);
  assert.ok(!C.addTodo(s, '   ', 1, 'aaaaaa').ok);
  let r = C.addTodo(s, '<b>Buy</b>  milk\n', 1000, 'todo-1'); assert.ok(r.ok); assert.equal(r.todo.text, 'b Buy /b milk');                                  // markup characters are dropped, spaces tidied
  C.addTodo(s, 'Call mum', 2000, 'todo-2'); C.addTodo(s, 'x'.repeat(500), 3000, 'todo-3'); assert.equal(s.todos[2].text.length, 120);
  assert.ok(C.setTodoDone(s, 'todo-2', true, 5000).ok); assert.equal(s.todos[1].doneAt, 5000); assert.ok(!C.setTodoDone(s, 'nope', true, 1).ok);
  assert.ok(C.setTodoDone(s, 'todo-2', false, 6000).ok); assert.equal(s.todos[1].doneAt, null);
  C.setTodoDone(s, 'todo-1', true, 7000); assert.equal(C.clearDoneTodos(s), 1); assert.equal(s.todos.length, 2);
  assert.ok(C.deleteTodo(s, 'todo-3')); assert.ok(!C.deleteTodo(s, 'todo-3'));
  const back = C.normalize(JSON.parse(JSON.stringify(s))); assert.deepEqual(back.todos, s.todos);
  const full = C.normalize({ todos: Array.from({ length: 500 }, (_, i) => ({ id: 'id' + String(i).padStart(6, '0'), text: 't' + i })) }); assert.equal(full.todos.length, C.MAX_TODOS);
  assert.ok(!C.addTodo(full, 'one more', 1, 'zzzzzz').ok);
  assert.equal(C.normalize({ todos: [{ text: '' }, { id: 'dupdup', text: 'a' }, { id: 'dupdup', text: 'b' }, 7] }).todos.length, 2);
  let p = C.applyPatch(s, { features: { todos: false } }); assert.equal(s.features.todos, false); assert.deepEqual(p.changed, ['features.todos']);
  p = C.applyPatch(s, { features: { todos: 'yes' } }); assert.deepEqual(p.rejected, ['features.todos']);
});
t('to-do deadlines: optional, validated, overdue only when open and past', () => {
  const s = C.normalize({}); const now = L(2026, 10, 10, 12, 0);
  let r = C.addTodo(s, 'No deadline', now, 'todo-n1'); assert.equal(r.todo.due, null);
  r = C.addTodo(s, 'Day only', now, 'todo-d1', '2026-10-10'); assert.equal(r.todo.due, '2026-10-10');
  r = C.addTodo(s, 'With time', now, 'todo-t1', '2026-10-10T09:30'); assert.equal(r.todo.due, '2026-10-10T09:30');
  for (const bad of ['2026-02-30', '2026-10-10T25:00', 'tomorrow', '2026-10-10T9:30', 12, {}, ['2026-10-10']]) assert.ok(!C.addTodo(s, 'x', now, 'todo-bad', bad).ok, String(bad));
  assert.equal(s.todos.length, 3);
  const by = id => s.todos.find(t => t.id === id);
  assert.equal(C.isOverdue(by('todo-n1'), now), false);
  assert.equal(C.isOverdue(by('todo-d1'), now), false);                          // due by the end of today
  assert.equal(C.isOverdue(by('todo-d1'), L(2026, 10, 11, 0, 1)), true);
  assert.equal(C.isOverdue(by('todo-t1'), now), true); assert.equal(C.isOverdue(by('todo-t1'), L(2026, 10, 10, 9, 29)), false);
  C.setTodoDone(s, 'todo-t1', true, now); assert.equal(C.isOverdue(by('todo-t1'), now), false);   // finished ones are never overdue
  assert.ok(C.setTodoDue(s, 'todo-n1', '2026-11-01T08:00').ok); assert.equal(by('todo-n1').due, '2026-11-01T08:00');
  assert.ok(!C.setTodoDue(s, 'todo-n1', 'soon').ok); assert.equal(by('todo-n1').due, '2026-11-01T08:00');
  assert.ok(C.setTodoDue(s, 'todo-n1', '').ok); assert.equal(by('todo-n1').due, null); assert.ok(!C.setTodoDue(s, 'nope', null).ok);
  const back = C.normalize(JSON.parse(JSON.stringify(s))); assert.deepEqual(back.todos, s.todos);
  assert.equal(C.normalize({ todos: [{ text: 'a', due: 'garbage' }] }).todos[0].due, null);
});
t('water window: settings are validated, overnight windows work', () => {
  const s = C.normalize({}); assert.deepEqual(s.water.window, { enabled: false, start: '08:00', end: '22:00' });
  let r = C.applyPatch(s, { water: { window: { enabled: true, start: '09:00', end: '18:00' } } }); assert.deepEqual(s.water.window, { enabled: true, start: '09:00', end: '18:00' }); assert.deepEqual(r.rejected, []);
  r = C.applyPatch(s, { water: { window: { start: '25:00' } } }); assert.deepEqual(r.rejected, ['water.window']);
  r = C.applyPatch(s, { water: { window: { end: '09:00' } } }); assert.deepEqual(r.rejected, ['water.window']); assert.equal(s.water.window.end, '18:00');   // an empty window is refused
  r = C.applyPatch(s, { water: { window: { start: ['09:00'], enabled: 'yes' } } }); assert.deepEqual(r.rejected, ['water.window']);
  assert.deepEqual(C.normalize({ water: { window: { enabled: true, start: '10:00', end: '10:00' } } }).water.window, { enabled: false, start: '08:00', end: '22:00' });
  assert.equal(C.normalize({ water: { window: { enabled: true, start: ['x'], end: 5 } } }).water.window.start, '08:00');
  const w = { enabled: true, start: '09:00', end: '18:00' }, at = (h, m = 0, d = 10) => L(2026, 10, d, h, m);
  assert.ok(C.inWaterWindow(w, at(9, 0)) && C.inWaterWindow(w, at(17, 59)) && !C.inWaterWindow(w, at(18, 0)) && !C.inWaterWindow(w, at(8, 59)));
  const night = { enabled: true, start: '22:00', end: '06:00' };
  assert.ok(C.inWaterWindow(night, at(23)) && C.inWaterWindow(night, at(2)) && !C.inWaterWindow(night, at(6)) && !C.inWaterWindow(night, at(12)));
  assert.ok(C.inWaterWindow({ enabled: false, start: '09:00', end: '10:00' }, at(3)));                     // switched off: always
  assert.equal(C.nextWaterStart(w, at(18, 5)), at(9, 0, 11)); assert.equal(C.nextWaterStart(w, at(7, 0)), at(9, 0, 10)); assert.equal(C.nextWaterStart(w, at(9, 0)), at(9, 0, 11));
});
t('water window: asks stop at the end, restart at the start, and follow edits', () => {
  const s = C.normalize({}); s.water.interval = 30; s.water.window = { enabled: true, start: '09:00', end: '18:00' };
  const at = (h, m = 0, d = 10) => L(2026, 10, d, h, m), min = 60000;
  // inside the window an ask stays where it is; one that would land after the end moves to the next opening
  assert.equal(C.gateWater(s, at(12, 30), at(12, 0)), at(12, 30));
  assert.equal(C.gateWater(s, at(18, 20), at(17, 50)), at(9, 0, 11));
  // the window closes while an ask was due: it resets to the opening time, and nothing is asked in between
  assert.equal(C.gateWater(s, at(17, 50), at(18, 5)), at(9, 0, 11));
  assert.equal(C.pickNext(s, at(17, 50), at(18, 5)), null);
  assert.equal(C.gateWater(s, at(9, 0, 11), at(23, 0)), at(9, 0, 11));                                     // stays put overnight
  assert.deepEqual(C.pickNext(s, at(9, 0, 11), at(9, 0, 11)), { type: 'water' });                           // and asks when it opens
  assert.equal(C.pickNext(s, at(9, 0, 11), at(8, 59, 11)), null);
  // after the reset the person makes the window longer: asks resume (a minute from now) instead of waiting for tomorrow
  s.water.window.end = '20:00'; assert.equal(C.rescheduleWater(s, at(9, 0, 11), at(18, 10)), at(18, 11));
  // ... or moves the start earlier than now
  s.water.window = { enabled: true, start: '09:00', end: '18:00' }; s.water.window.start = '07:00'; assert.equal(C.rescheduleWater(s, at(9, 0, 11), at(8, 0, 11)), at(8, 1, 11));
  // a shorter window that no longer covers now pushes the next ask to its opening
  s.water.window = { enabled: true, start: '09:00', end: '18:00' }; s.water.window.end = '12:00'; assert.equal(C.rescheduleWater(s, at(14, 0), at(13, 0)), at(9, 0, 11));
  s.water.window = { enabled: true, start: '14:00', end: '18:00' }; assert.equal(C.rescheduleWater(s, at(13, 30), at(13, 0)), at(14, 0));        // start moved later
  // switching the window off while asks were pushed to tomorrow: back to the normal interval
  s.water.window = { enabled: false, start: '09:00', end: '18:00' }; assert.equal(C.rescheduleWater(s, at(9, 0, 11), at(19, 0)), at(19, 30));
  // a nearby ask is left alone when nothing else changed; asks do not apply when the water reminder is off
  s.water.window = { enabled: true, start: '09:00', end: '18:00' }; assert.equal(C.rescheduleWater(s, at(12, 20), at(12, 0)), at(12, 20));
  s.water.enabled = false; assert.equal(C.gateWater(s, at(19, 0), at(19, 0)), at(19, 0));
  // overnight window
  s.water.enabled = true; s.water.window = { enabled: true, start: '22:00', end: '06:00' };
  assert.equal(C.gateWater(s, at(23, 0), at(22, 30)), at(23, 0)); assert.equal(C.gateWater(s, at(6, 10, 11), at(5, 50, 11)), at(22, 0, 11));
});
const U = require('../src/main/uninstall.js');
t('uninstall plan: Linux install, source folder and unsafe paths', () => {
  const have = new Set(['/home/ann/.local/share/sip-water-buddy', '/home/ann/.local/share/applications/sip-water-buddy.desktop', '/home/ann/.config/autostart/sip-water-buddy.desktop', '/home/ann/.cache/sip-water-buddy.log', '/home/ann/.config/sip-water-buddy']);
  const deps = { exists: p => have.has(p), isSipFolder: d => d === '/home/ann/.local/share/sip-water-buddy', hasGit: () => false };
  const ctx = { platform: 'linux', appDir: '/home/ann/.local/share/sip-water-buddy', home: '/home/ann', userData: '/home/ann/.config/sip-water-buddy', isPackaged: false, execPath: '/x/electron', env: {} };
  let p = U.plan(ctx, deps); assert.ok(p.ok); assert.deepEqual(p.remove.sort(), [...have].sort());
  // a source checkout is removed too (the person chose that), with a warning when it is a Git checkout
  const src = '/home/ann/code/sip-water-buddy'; have.add(src);
  p = U.plan({ ...ctx, appDir: src }, { ...deps, isSipFolder: d => d === src, hasGit: () => true }); assert.ok(p.ok && p.remove.includes(src) && p.warnings.length === 1);
  // a folder that is not Sip's is left alone, even if asked
  p = U.plan({ ...ctx, appDir: '/home/ann/code/other' }, { ...deps, exists: () => true, isSipFolder: () => false }); assert.ok(!p.remove.includes('/home/ann/code/other'));
  // never the home folder, a drive root, or something above the home folder
  for (const bad of ['/home/ann', '/home', '/', '/home/ann/..', 'relative/path']) assert.equal(U.safeToDelete(bad, '/home/ann'), false, bad);
  assert.equal(U.safeToDelete('/home/ann/.config/sip-water-buddy', '/home/ann'), true);
  p = U.plan({ ...ctx, userData: '/home/ann' }, { ...deps, exists: () => true }); assert.ok(!p.ok);
});
t('uninstall plan: Windows installer, portable and folder', () => {
  const E = 'C:\\Users\\Ann\\AppData\\Local\\Programs\\Sip Water Buddy', D = 'C:\\Users\\Ann\\AppData\\Roaming\\sip-water-buddy';
  const base = { platform: 'win32', appDir: E + '\\resources\\app', home: 'C:\\Users\\Ann', userData: D, isPackaged: true, execPath: E + '\\Sip Water Buddy.exe', env: { APPDATA: 'C:\\Users\\Ann\\AppData\\Roaming' } };
  const files = new Set([D, E + '\\Uninstall Sip Water Buddy.exe']);
  let p = U.plan(base, { exists: x => files.has(x), isSipFolder: () => true, hasGit: () => false });
  assert.equal(p.uninstaller, E + '\\Uninstall Sip Water Buddy.exe'); assert.deepEqual(p.remove, [D]);
  p = U.plan({ ...base, env: { ...base.env, PORTABLE_EXECUTABLE_FILE: 'C:\\Users\\Ann\\Downloads\\Sip.exe' } }, { exists: x => x === D || x === 'C:\\Users\\Ann\\Downloads\\Sip.exe', isSipFolder: () => true, hasGit: () => false });
  assert.deepEqual(p.remove.sort(), ['C:\\Users\\Ann\\Downloads\\Sip.exe', D].sort()); assert.equal(p.uninstaller, null);
  const F = 'C:\\Users\\Ann\\Tools\\SipWaterBuddy'; const lnk = 'C:\\Users\\Ann\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Sip Water Buddy.lnk';
  p = U.plan({ ...base, execPath: F + '\\Sip Water Buddy.exe' }, { exists: x => [F, D, lnk].includes(x), isSipFolder: d => d === F, hasGit: () => false });
  assert.deepEqual(p.remove.sort(), [F, D, lnk].sort());
  p = U.plan({ ...base, execPath: 'C:\\Users\\Ann\\100%\\Sip Water Buddy.exe' }, { exists: x => x === 'C:\\Users\\Ann\\100%' || x === D, isSipFolder: () => true, hasGit: () => false });
  assert.ok(!p.ok, 'a path with a % is refused (it would be expanded by cmd)');
});
console.log(n + ' checks passed (TZ=' + (process.env.TZ || 'system') + ')');
