'use strict';
// End-to-end check: launches the real app (main process, both windows, real preload scripts) and drives it.
//   xvfb-run -a electron --no-sandbox --disable-gpu tests/e2e/selftest.js
const { app, BrowserWindow, shell, Menu } = require('electron');
const Brand = require('../../src/main/branding.js');
const opened = []; shell.openExternal = async u => { opened.push(u); };       // never open a real browser during the test
const path = require('path'), fs = require('fs');
const DATA = '/tmp/sip-selftest-data', SHOTS = process.env.SIP_SHOTS_DIR || '/tmp/shots';
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
app.setPath('userData', DATA);
const results = [], consoleMsgs = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); };
app.on('web-contents-created', (_e, wc) => wc.on('console-message', ev => consoleMsgs.push({ level: ev.level, msg: String(ev.message).slice(0, 300) })));
let trayMenu = [];                                                               // the tray menu as Sip last built it, so the test can click its items
const buildMenu = Menu.buildFromTemplate.bind(Menu); Menu.buildFromTemplate = t => { trayMenu = t; return buildMenu(t); };
require(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 60000, step = 300) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t0 > ms) return false; await sleep(step); } }
const win = title => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === title);
// a rejected script says which script it was (Electron's own message is just "Script failed to execute")
const run = (w, code) => w.webContents.executeJavaScript(code, true).catch(e => { throw new Error(String(e && e.message || e) + '\n    in ' + (w.isDestroyed() ? 'a destroyed window' : '"' + w.getTitle() + '" (' + w.webContents.getURL().split('/').slice(-2).join('/') + ')') + ': ' + String(code).replace(/\s+/g, ' ').slice(0, 200)); });
const shot = async (w, name) => { try { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); } catch (e) { console.log('shot failed', name, e.message); } };

app.whenReady().then(async () => {
  try {
    const overlay = await waitFor(() => win('Sip'), 20000); check('character window created', !!overlay);
    await waitFor(() => run(overlay, "typeof window.sip === 'object' && !!document.getElementById('bubble')"), 20000);
    await waitFor(async () => /ready/.test(fs.readFileSync(path.join(DATA, 'sip.log'), 'utf8').split('Status:').pop() || ''), 60000);
    check('character window has its bridge', await run(overlay, "Object.keys(window.sip).includes('done') && !('require' in window) && typeof process === 'undefined'"));
    check('no Node access in the character window', await run(overlay, "typeof require === 'undefined' && typeof module === 'undefined'"));

    // let the start-up greeting finish first (it waits for an answer, like any check-in)
    check('start-up greeting waits for an answer', await waitFor(() => run(overlay, "!document.getElementById('bActions').hidden && !document.getElementById('waterBtns').hidden"), 150000));
    await run(overlay, "document.getElementById('skip').click()");
    check('answering the greeting sends him away', await waitFor(() => !overlay.isVisible(), 150000));

    // ---- open Settings (what a second launch does) ----
    app.emit('second-instance');
    const sw = await waitFor(() => win('Sip Settings'), 20000); check('settings window opens', !!sw);
    await waitFor(() => run(sw, "!!document.querySelector('#heroName').value"), 20000);
    check('no Node access in the settings window', await run(sw, "typeof require === 'undefined' && typeof process === 'undefined'"));
    check('defaults shown', await run(sw, "document.querySelector('#heroName').value === 'Hero' && document.querySelector('#petName').value === 'Buddy' && document.querySelector('input[name=show]:checked').value === 'both'"));
    await shot(sw, 'settings-characters');

    // ---- who shows up: only one can be hidden (three choices, never both hidden) ----
    check('three visibility choices only', await run(sw, "[...document.querySelectorAll('input[name=show]')].map(r => r.value).join() === 'both,hero,pet'"));
    await run(sw, "document.querySelector('input[name=show][value=pet]').click()");
    check('hide the hero -> state saved', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.show === 'pet')"), 5000));
    check('forged value rejected by main', await run(sw, "sipSettings.patch({ show: { hero: false, pet: false } }).then(r => r.rejected.includes('show') && r.view.show === 'pet')"));
    check('forged values rejected (names/looks/volume/path tricks)', await run(sw, "sipSettings.patch({ hero: { look: '../../etc/passwd' }, pet: { look: 'file:../x.glb', speed: 99 }, sound: { volume: 7 } }).then(r => r.rejected.length === 4)"));

    // ---- names ----
    await run(sw, "(() => { const i = document.querySelector('#heroName'); i.focus(); i.value = 'Captain <b>Splash</b>'; i.dispatchEvent(new Event('input')); i.blur(); })()");
    check('hero name saved, markup stripped', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.hero.name === 'Captain bSplash/b' || s.hero.name === 'Captain b Splash /b' || /^Captain/.test(s.hero.name) && !/[<>]/.test(s.hero.name))"), 5000));
    await run(sw, "(() => { const i = document.querySelector('#petName'); i.focus(); i.value = 'Mochi'; i.dispatchEvent(new Event('input')); i.blur(); })()");
    check('pet name saved', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.pet.name === 'Mochi')"), 5000));
    await run(sw, "document.querySelector('input[name=show][value=both]').click()");

    // ---- reminders ----
    await run(sw, "document.querySelector('#tab-reminders').click()");
    await run(sw, "(() => { document.querySelector('#remTitle').value = 'Stand up and stretch'; document.querySelector('#quickChips [data-quick=\"1\"]').click(); })()");
    check('quick-add creates a reminder', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.reminders.length === 1 && s.reminders[0].title === 'Stand up and stretch' && s.reminders[0].kind === 'once')"), 8000));
    check('quick-add without a title is refused with a message', await run(sw, "(async () => { document.querySelector('#remTitle').value = ''; document.querySelector('#quickChips [data-quick=\"10\"]').click(); await new Promise(r => setTimeout(r, 300)); return !document.querySelector('#formError').hidden && (await sipSettings.getState()).reminders.length === 1; })()"));
    await run(sw, "(() => { document.querySelector('#remTitle').value = '<img src=x onerror=alert(1)> Take medicine'; document.querySelector('input[name=kind][value=weekly]').click(); document.querySelector('input[name=kind][value=weekly]').dispatchEvent(new Event('change')); document.querySelector('#remTimeWeekly').value = '08:30'; document.querySelector('#remNote').value = 'With food'; document.querySelector('#remSubmit').click(); })()");
    check('custom weekly reminder added (weekdays, 08:30), markup stripped', await waitFor(() => run(sw, "sipSettings.getState().then(s => { const r = s.reminders[1]; return r && r.kind === 'weekly' && r.at === '08:30' && r.days.join() === '1,2,3,4,5' && !/[<>]/.test(r.title) && r.note === 'With food'; })"), 8000));
    check('reminder list rendered as text only', await run(sw, "document.querySelectorAll('#remList .rem').length === 2 && !document.querySelector('#remList img') && document.querySelector('#remList').textContent.includes('Take medicine')"));
    await shot(sw, 'settings-reminders');
    check('past one-time reminder rejected', await run(sw, "sipSettings.reminderAdd({ title: 'old', kind: 'once', date: '2020-01-01', at: '09:00' }).then(r => r.ok === false && /passed/.test(r.error))"));

    // ---- water on/off ----
    check('water reminder can be turned off', await run(sw, "sipSettings.patch({ water: { enabled: false } }).then(r => r.view.water.enabled === false)"));
    await run(sw, "sipSettings.patch({ water: { enabled: true, interval: 45, goal: 10 } })");
    check('water interval and goal saved', await run(sw, "sipSettings.getState().then(s => s.water.interval === 45 && s.water.goal === 10)"));

    // ---- a reminder reaches the character, who waits for an answer ----
    const rid = await run(sw, "sipSettings.getState().then(s => s.reminders[0].id)");
    await run(sw, `sipSettings.reminderTest('${rid}')`);
    check('character shows the reminder text and its buttons', await waitFor(() => run(overlay, "document.getElementById('bText').textContent === 'Stand up and stretch' && !document.getElementById('remBtns').hidden && document.getElementById('waterBtns').hidden"), 90000));
    await shot(overlay, 'overlay-reminder');
    check('overlay window is visible and stays until answered', overlay.isVisible());
    await run(overlay, "document.getElementById('remDone').click()");
    check('answering sends him away', await waitFor(() => !overlay.isVisible(), 120000));
    check('previewing did not change the schedule', await run(sw, "sipSettings.getState().then(s => s.reminders[0].done === false)"));

    // ---- pet only / hero only ----
    await run(sw, "sipSettings.patch({ show: 'pet' })");
    await run(sw, "sipSettings.askNow()");
    check('pet-only: hero hidden, pet kept', await waitFor(() => run(overlay, "document.getElementById('scene').classList.contains('no-hero') && !document.getElementById('bubble').hidden"), 90000));
    check('pet-only: hero-only buttons hidden', await run(overlay, "[...document.querySelectorAll('[data-needs]')].filter(b => b.dataset.needs === 'hero' || b.dataset.needs === 'both').every(b => b.hidden)"));
    await shot(overlay, 'overlay-pet-only');
    await run(overlay, "document.getElementById('waterBtns').hidden ? document.getElementById('helloBtns') : document.getElementById('skip').click()");
    await waitFor(() => !overlay.isVisible(), 120000);
    await run(sw, "sipSettings.patch({ show: 'hero' })");
    await run(sw, "sipSettings.askNow()");
    check('hero-only: pet hidden, pet buttons hidden', await waitFor(() => run(overlay, "!document.getElementById('scene').classList.contains('no-hero') && [...document.querySelectorAll('[data-needs]')].filter(b => b.dataset.needs === 'pet' || b.dataset.needs === 'both').every(b => b.hidden) && !document.getElementById('bubble').hidden"), 90000));
    await shot(overlay, 'overlay-hero-only');
    await run(overlay, "document.getElementById('skip').click()");
    await waitFor(() => !overlay.isVisible(), 120000);
    await run(sw, "sipSettings.patch({ show: 'both' })");

    // ---- 2.1: the question comes with the character, hovering stops them, leaving is configurable, waiting spot ----
    const { screen } = require('electron');
    let fakeCursor = { x: -50, y: -50 }; screen.getCursorScreenPoint = () => fakeCursor;       // the test is the "mouse"
    const bnds = () => { const b = overlay.getBounds(); return b.x + ',' + b.y; };
    await run(sw, "sipSettings.patch({ behavior: { leave: 'instant' } })");
    let t0 = Date.now(); await run(sw, "sipSettings.askNow()");
    const early = await waitFor(() => run(overlay, "!document.getElementById('bubble').hidden && !document.getElementById('bActions').hidden && document.getElementById('bText').textContent.length > 0"), 8000, 100);
    check('the message comes with the character, not after the tour', early && Date.now() - t0 < 6000, Date.now() - t0);
    // while it walks, put the mouse on it: it must hold still, then move again when the mouse leaves
    const moving = await waitFor(async () => { const a = bnds(); await sleep(350); return a !== bnds(); }, 30000, 50);
    check('the character walks around while the question is showing', moving);
    // keep the "mouse" on the hero while it may still be walking (on a slow machine a frame can move it a long way), then see that it stays put
    // (the scene is mirrored when they walk left, so ask the page where the hero really is)
    let following = true;
    (async () => { while (following) { try { const b = overlay.getBounds(), c = await run(overlay, "(() => { const r = document.getElementById('fig').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"); fakeCursor = { x: b.x + c[0], y: b.y + c[1] }; } catch (e) { /* retry */ } await sleep(40); } })();
    await sleep(2500); following = false; await sleep(120);
    const f1 = bnds(); await sleep(1500); const f2 = bnds();
    check('hovering the mouse over them makes them stop', f1 === f2, [f1, f2]);
    fakeCursor = { x: -50, y: -50 };
    check('they move again when the mouse is taken away', await waitFor(async () => { const a = bnds(); await sleep(350); return a !== bnds(); }, 20000, 50));
    t0 = Date.now(); await run(overlay, "document.getElementById('skip').click()");
    check('leave "right away": gone within a few seconds', await waitFor(() => !overlay.isVisible(), 8000, 100) && Date.now() - t0 < 7000, Date.now() - t0);
    await run(sw, "sipSettings.patch({ behavior: { leave: 'custom', leaveSecs: 30 } })");
    await run(sw, "sipSettings.askNow()");
    await waitFor(() => run(overlay, "!document.getElementById('bActions').hidden"), 8000, 100);
    await run(overlay, "document.getElementById('skip').click()");
    check('a "Go now" button appears in the farewell', await waitFor(() => run(overlay, "!document.getElementById('goRow').hidden && !document.getElementById('bubble').hidden"), 8000, 100));
    check('they stay while the custom time runs', overlay.isVisible());
    t0 = Date.now(); await run(overlay, "document.getElementById('goNow').click()");
    check('"Go now" sends them off immediately', await waitFor(() => !overlay.isVisible(), 8000, 100) && Date.now() - t0 < 5000, Date.now() - t0);
    // answering with the normal goodbye (drink pose first): the Go now button and the goodbye text are there from the first moment
    await run(sw, "sipSettings.patch({ behavior: { leave: 'normal' } })");
    await run(sw, "sipSettings.askNow()");
    await waitFor(() => run(overlay, "!document.getElementById('bActions').hidden"), 8000, 100);
    await run(overlay, "document.getElementById('yes').click()");
    check('Go now is shown straight away, with the goodbye text, while the pose plays', await waitFor(() => run(overlay, "!document.getElementById('goRow').hidden && !document.getElementById('bubble').hidden && /glass|today/i.test(document.getElementById('bText').textContent) && !/Had a glass\\?|Done\\?/.test(document.getElementById('bText').textContent)"), 2500, 50));
    t0 = Date.now(); await run(overlay, "document.getElementById('goNow').click()");
    check('Go now works during the first pose', await waitFor(() => !overlay.isVisible(), 8000, 100) && Date.now() - t0 < 5000, Date.now() - t0);
    await run(sw, "sipSettings.patch({ behavior: { leave: 'instant' } })");
    // waiting spot: choose it with the pointer, they walk there and wait
    await run(sw, "sipSettings.askNow()");
    await waitFor(() => run(overlay, "!document.getElementById('bActions').hidden"), 8000, 100);
    await run(overlay, "document.getElementById('waitBtn').click()");
    check('"Wait here" opens the screen to click on', await waitFor(() => run(overlay, "!document.getElementById('aim').hidden && document.getElementById('aim').offsetWidth > 800"), 8000, 100));
    await run(overlay, "document.getElementById('aim').dispatchEvent(new MouseEvent('click', { clientX: 1000, clientY: 700, bubbles: true }))");
    const spot = await waitFor(() => run(sw, "sipSettings.getState().then(s => s.behavior.spot)"), 5000, 100);
    check('the chosen spot is remembered', spot && Math.abs(spot.x - 1000) <= 2 && Math.abs(spot.y - 700) <= 2, spot);
    check('they walk to the spot and wait there with the question showing', await waitFor(() => { const b = overlay.getBounds(); return Math.abs(b.x - (spot.x - 150)) <= 3 && Math.abs(b.y - (spot.y - 405)) <= 3 && overlay.getBounds().width === 470; }, 40000, 200));
    check('the question is still on screen at the spot', await run(overlay, "!document.getElementById('bActions').hidden"));
    await run(overlay, "document.getElementById('parkBtn').click()");
    check('"Always wait here" turns on the saved spot', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.behavior.parked === true)"), 5000, 100));
    await run(overlay, "document.getElementById('skip').click()");
    await waitFor(() => !overlay.isVisible(), 10000, 100);
    await run(sw, "sipSettings.askNow()");
    check('with a saved spot they appear there straight away', await waitFor(() => { const b = overlay.getBounds(); return overlay.isVisible() && Math.abs(b.x - (spot.x - 150)) <= 3 && Math.abs(b.y - (spot.y - 405)) <= 3; }, 10000, 100));
    await sleep(2500); check('and stay there (no wandering)', Math.abs(overlay.getBounds().x - (spot.x - 150)) <= 3);
    await shot(overlay, 'overlay-waiting-spot');
    await run(overlay, "document.getElementById('skip').click()");
    await waitFor(() => !overlay.isVisible(), 10000, 100);
    check('the waiting spot can be released and forgotten from Settings', await run(sw, "sipSettings.patch({ behavior: { parked: false } }).then(() => sipSettings.patch({ behavior: { spot: null } })).then(r => r.view.behavior.spot === null && r.view.behavior.parked === false)"));
    await run(sw, "sipSettings.patch({ behavior: { leave: 'normal' } })");
    check('Settings has the leave-time options and an uninstall button', await run(sw, "document.querySelector('#tab-general').click() || (!!document.querySelector('input[name=leave][value=custom]') && !!document.getElementById('uninstall') && typeof sipSettings.uninstall === 'function')"));
    await sleep(300); await shot(sw, 'settings-general');
    screen.getCursorScreenPoint = require('electron').screen.getCursorScreenPoint;

    // ---- 2.2: to-do list, quick add from the tray, and the 30-day statistics ----
    const menuItem = label => trayMenu.find(i => i.label && i.label.startsWith(label));
    await run(sw, "document.querySelector('#tab-general').click()");
    check('tray menu offers "Show todos" and "Quick add todo…" (to-do list is on by default)', !!menuItem('Show todos') && !!menuItem('Quick add todo'));
    check('Settings has a To-dos tab and a Stats tab', await run(sw, "!document.querySelector('#tab-todos').hidden && !!document.querySelector('#tab-stats')"));
    let tv = await run(sw, "sipSettings.todoAdd('<b>Buy</b> milk').then(r => ({ ok: r.ok, todos: r.view.todos.map(t => t.text) }))");
    check('adding a to-do works and strips markup', tv.ok && tv.todos.length === 1 && !/[<>]/.test(tv.todos[0]), tv);
    check('an empty to-do is refused', await run(sw, "sipSettings.todoAdd('   ').then(r => r.ok === false && r.view.todos.length === 1)"));
    check('forged to-do calls are ignored (bad id, bad types)', await run(sw, "sipSettings.todoDone({}, true).then(r => r.ok === false).then(a => sipSettings.todoDelete(12345).then(r => a && r.ok === false)).then(a => sipSettings.todoAdd({ text: 'x' }).then(r => a && r.ok === false))"));
    await run(sw, "document.querySelector('#tab-todos').click()"); await sleep(300);
    check('the To-dos tab lists it as plain text', await run(sw, "document.querySelectorAll('#todoList li').length === 1 && document.querySelector('#todoList li span').textContent === 'b Buy /b milk' && !document.querySelector('#todoList li img, #todoList li b')"));
    // quick add from the tray menu
    menuItem('Quick add todo').click();
    const qw = await waitFor(() => win('Sip Quick Add'), 10000);
    check('"Quick add todo…" opens the small quick-add window', !!qw);
    check('the quick-add window has only its own bridge and no Node', await run(qw, "typeof window.sipQuick === 'object' && typeof require === 'undefined' && typeof process === 'undefined' && typeof window.sip === 'undefined' && typeof window.sipSettings === 'undefined'"));
    check('the settings window cannot use the quick-add bridge', await run(sw, "typeof window.sipQuick === 'undefined'"));
    await run(qw, "(() => { document.getElementById('text').value = 'Call the plumber'; document.getElementById('form').requestSubmit(); })()");
    check('submitting adds the to-do', await waitFor(() => run(sw, "sipSettings.getState().then(s => s.todos.some(t => t.text === 'Call the plumber'))"), 8000, 100));
    check('the quick-add window closes by itself after adding', await waitFor(() => !win('Sip Quick Add'), 8000, 100));
    check('the new to-do shows up in the open To-dos tab', await waitFor(() => run(sw, "[...document.querySelectorAll('#todoList li span')].some(s => s.textContent === 'Call the plumber')"), 5000, 100));
    // finish, clear, delete
    await run(sw, "document.querySelector('#todoList li input[type=checkbox]').click()"); await sleep(400);
    tv = await run(sw, "sipSettings.getState().then(s => s.todos.map(t => [t.text, t.done]))");
    check('ticking an item marks it done', tv.filter(t => t[1]).length === 1, tv);
    await run(sw, "document.querySelector('#todoClear').click()"); await sleep(400);
    check('"Clear completed" removes finished ones only', await run(sw, "sipSettings.getState().then(s => s.todos.length === 1 && !s.todos[0].done)"));
    check('the tray shows how many are open', !!menuItem('Show todos (1 open)'), trayMenu.map(i => i.label));
    menuItem('Show todos').click(); await sleep(500);
    check('"Show todos" opens Settings on the To-dos tab', await run(sw, "document.querySelector('#tab-todos').getAttribute('aria-selected') === 'true' && !document.querySelector('#panel-todos').hidden"));
    await run(sw, "document.querySelector('#todoList li button').click()"); await sleep(400);
    check('the delete button removes an item', await run(sw, "sipSettings.getState().then(s => s.todos.length === 0)"));
    // switch it off
    await run(sw, "sipSettings.todoAdd('Keep me')");
    await run(sw, "document.querySelector('#tab-general').click(); document.getElementById('todosOn').click()"); await sleep(500);
    check('switching the to-do list off hides the tab and the tray items', await run(sw, "document.querySelector('#tab-todos').hidden === true") && !menuItem('Show todos') && !menuItem('Quick add todo'));
    check('adding is refused while it is off, and the items are kept', await run(sw, "sipSettings.todoAdd('nope').then(r => r.ok === false && /switched off/.test(r.error) && r.view.todos.length === 1)"));
    await run(sw, "document.getElementById('todosOn').click()"); await sleep(500);
    check('switching it back on brings the tab, the tray items and the list back', await run(sw, "document.querySelector('#tab-todos').hidden === false") && !!menuItem('Quick add todo') && await run(sw, "sipSettings.getState().then(s => s.todos.length === 1)"));
    // statistics: earlier check-ins in this test were skipped, so they must show up
    await run(sw, "document.querySelector('#tab-stats').click()"); await sleep(500);
    const stv = await run(sw, "sipSettings.getState().then(s => s.stats)");
    check('stats: 30 days, today tracked, skipped check-ins counted with their minutes', stv.days.length === 30 && stv.days[29].has && stv.totals.skips >= 1 && stv.totals.skipMin >= 30, stv.totals);
    check('stats page draws three charts, six tiles and a 30-row table', await run(sw, "document.querySelectorAll('#panel-stats .chart svg').length === 3 && document.querySelectorAll('#statTiles .tile').length === 6 && document.querySelectorAll('#statTable tbody tr').length === 30 && document.querySelectorAll('#chartGlasses rect').length >= 30"));
    await shot(sw, 'settings-stats');
    await run(sw, "document.querySelector('#tab-todos').click()"); await sleep(300); await shot(sw, 'settings-todos');
    await run(sw, "document.querySelector('#tab-general').click()");

    // ---- 2.3: fixed footer, to-do deadlines, and the water window ----
    check('the credit bar stays at the bottom of the window while a long tab scrolls', await run(sw, `(() => { const g = document.querySelector('#tab-general'); g.click(); const sec = document.querySelector('#panel-general'); const f = () => Math.round(document.querySelector('.brandbar').getBoundingClientRect().bottom); const a = f(); sec.scrollTop = 99999; return sec.scrollHeight > sec.clientHeight && a === innerHeight && f() === a && sec.scrollTop > 0; })()`));
    check('...and on every tab, even a short one', await run(sw, "(async () => { for (const t of ['characters','reminders','todos','stats','sounds','general']) { document.querySelector('#tab-' + t).click(); await new Promise(r => setTimeout(r, 60)); if (Math.round(document.querySelector('.brandbar').getBoundingClientRect().bottom) !== innerHeight) return t; } return true; })()"));
    const ymdOf = (d, off = 0) => { const x = new Date(d); x.setDate(x.getDate() + off); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const today = ymdOf(Date.now()), yesterday = ymdOf(Date.now(), -1), nextWeek = ymdOf(Date.now(), 7);
    await run(sw, "sipSettings.getState().then(s => Promise.all(s.todos.map(t => sipSettings.todoDelete(t.id))))");
    check('a to-do can be added without a deadline, with a date, or with a date and time', await run(sw, `(async () => { const a = await sipSettings.todoAdd('No deadline'), b = await sipSettings.todoAdd('Late one', '${yesterday}T09:00'), c = await sipSettings.todoAdd('Later', '${nextWeek}'); const t = c.view.todos; return a.ok && b.ok && c.ok && t.length === 3 && t[0].due === null && t[1].due === '${yesterday}T09:00' && t[2].due === '${nextWeek}'; })()`));
    check('an invalid deadline is refused and nothing is added', await run(sw, "(async () => { const r1 = await sipSettings.todoAdd('Bad', '2026-02-30'), r2 = await sipSettings.todoAdd('Bad', 'tomorrow'), r3 = await sipSettings.todoAdd('Bad', { x: 1 }); const v = await sipSettings.getState(); return !r1.ok && !r2.ok && !r3.ok && v.todos.length === 3; })()"));
    check('past deadlines are flagged overdue, later ones are not', await run(sw, "sipSettings.getState().then(s => { const o = Object.fromEntries(s.todos.map(t => [t.text, t.overdue])); return o['Late one'] === true && o['Later'] === false && o['No deadline'] === false; })"));
    check('the tray shows how many are overdue', !!menuItem('Show todos (3 open, 1 overdue)'), trayMenu.map(i => i.label));
    await run(sw, "document.querySelector('#tab-todos').click()"); await sleep(400);
    check('the list shows an Overdue badge and puts the soonest deadline first, undated last', await run(sw, "(() => { const li = [...document.querySelectorAll('#todoList li')]; const names = li.map(x => x.querySelector('label span').textContent); return names.join('|') === 'Late one|Later|No deadline' && li[0].classList.contains('late') && /^Overdue/.test(li[0].querySelector('.badge').textContent) && /^Due in/.test(li[1].querySelector('.badge').textContent) && !li[2].querySelector('.badge'); })()"));
    await run(sw, `(() => { const i = [...document.querySelectorAll('#todoList li')].find(x => x.textContent.includes('No deadline')).querySelectorAll('input')[1]; i.value = '${today}'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500);
    check('a deadline can be set on an existing item (date only: due by the end of today, so not overdue)', await run(sw, `sipSettings.getState().then(s => { const t = s.todos.find(x => x.text === 'No deadline'); return t.due === '${today}' && t.overdue === false; })`));
    await run(sw, `(() => { const li = [...document.querySelectorAll('#todoList li')].find(x => x.textContent.includes('No deadline')); const [, d, t] = li.querySelectorAll('input'); t.value = '23:30'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500);
    check('a time can be added to it', await run(sw, `sipSettings.getState().then(s => s.todos.find(x => x.text === 'No deadline').due === '${today}T23:30')`));
    await run(sw, `(() => { const li = [...document.querySelectorAll('#todoList li')].find(x => x.textContent.includes('No deadline')); const d = li.querySelectorAll('input')[1]; d.value = ''; d.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(500);
    check('clearing the date removes the deadline', await run(sw, "sipSettings.getState().then(s => s.todos.find(x => x.text === 'No deadline').due === null)"));
    await run(sw, "(() => { const f = document.getElementById('todoText'); f.value = 'With form deadline'; document.getElementById('todoDue').value = '" + nextWeek + "'; document.getElementById('todoDue').dispatchEvent(new Event('input')); document.getElementById('todoDueTime').value = '08:15'; document.getElementById('todoForm').requestSubmit(); })()"); await sleep(600);
    check('the add form takes an optional deadline', await run(sw, `sipSettings.getState().then(s => (s.todos.find(x => x.text === 'With form deadline') || {}).due === '${nextWeek}T08:15')`));
    menuItem('Quick add todo').click();
    const qw2 = await waitFor(() => win('Sip Quick Add'), 10000);
    await run(qw2, `(() => { document.getElementById('text').value = 'Quick with deadline'; const d = document.getElementById('due'); d.value = '${nextWeek}'; d.dispatchEvent(new Event('input')); document.getElementById('dueTime').value = '17:45'; document.getElementById('form').requestSubmit(); })()`);
    check('quick add takes an optional deadline too', await waitFor(() => run(sw, `sipSettings.getState().then(s => (s.todos.find(x => x.text === 'Quick with deadline') || {}).due === '${nextWeek}T17:45')`), 8000, 100));
    await waitFor(() => !win('Sip Quick Add'), 8000, 100);
    await shot(sw, 'settings-todos-deadlines');

    // water window: asks only inside the hours, reset at the end, resume when the hours are widened
    const hm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const H = 3600000, M = 60000, st2 = () => run(sw, "sipSettings.getState().then(s => s.water)");
    await run(sw, "sipSettings.patch({ water: { enabled: true, interval: 30, window: { enabled: false } } })");
    check('water window: an empty window (same start and end) is refused', await run(sw, "sipSettings.patch({ water: { window: { enabled: true, start: '10:00', end: '10:00' } } }).then(r => r.rejected.includes('water.window'))") && (await st2()).window.enabled === false);
    check('water window: a bad time is refused', await run(sw, "sipSettings.patch({ water: { window: { start: '25:61' } } }).then(r => r.rejected.includes('water.window'))"));
    // a window that opens in two hours: the next ask is moved to its opening
    const tw0 = Date.now(); let w = (await run(sw, `sipSettings.patch({ water: { window: { enabled: true, start: '${hm(tw0 + 2 * H)}', end: '${hm(tw0 + 3 * H)}' } } }).then(r => r.view.water)`));
    check('water window: outside the hours the next ask waits for the opening', Math.abs(w.nextAt - (tw0 + 2 * H)) < 2 * M + 1000, [new Date(w.nextAt).toString(), hm(tw0 + 2 * H)]);
    // the window is widened so that it covers now: asks resume about a minute later instead of waiting for the opening
    w = await run(sw, `sipSettings.patch({ water: { window: { start: '${hm(Date.now() - H)}', end: '${hm(Date.now() + H)}' } } }).then(r => r.view.water)`);
    check('water window: widening it over "now" brings the asks back within a couple of minutes', w.nextAt > Date.now() && w.nextAt < Date.now() + 3 * M, new Date(w.nextAt).toString());
    // the window is moved so that it ended an hour ago: the ask is reset to the next opening (tomorrow)
    w = await run(sw, `sipSettings.patch({ water: { window: { start: '${hm(Date.now() - 3 * H)}', end: '${hm(Date.now() - H)}' } } }).then(r => r.view.water)`);
    const opening = new Date(); opening.setHours(+hm(Date.now() - 3 * H).slice(0, 2), +hm(Date.now() - 3 * H).slice(3), 0, 0); if (opening.getTime() <= Date.now()) opening.setDate(opening.getDate() + 1);
    check('water window: after the end the ask is reset to the opening time', Math.abs(w.nextAt - opening.getTime()) < 2 * M + 1000, [new Date(w.nextAt).toString(), opening.toString()]);
    // ... then the end is made later again: asks resume
    w = await run(sw, `sipSettings.patch({ water: { window: { end: '${hm(Date.now() + H)}' } } }).then(r => r.view.water)`);
    check('water window: raising the end time after the reset brings the asks back', w.nextAt > Date.now() && w.nextAt < Date.now() + 3 * M, new Date(w.nextAt).toString());
    w = await run(sw, "sipSettings.patch({ water: { window: { enabled: false } } }).then(r => r.view.water)");
    check('water window: switching it off goes back to the normal interval', w.nextAt > Date.now() && w.nextAt <= Date.now() + 31 * M, new Date(w.nextAt).toString());
    await run(sw, "document.querySelector('#tab-reminders').click()"); await sleep(400);
    check('water window: the Reminders tab has the controls', await run(sw, "!!document.getElementById('winOn') && !!document.getElementById('winStart') && !!document.getElementById('winEnd')"));
    await run(sw, `(() => { const c = document.getElementById('winOn'); if (!c.checked) c.click(); })()`); await sleep(500);
    check('water window: ticking the box in the page turns it on', await run(sw, "sipSettings.getState().then(s => s.water.window.enabled === true)"));
    await shot(sw, 'settings-water-window');
    await run(sw, "sipSettings.patch({ water: { interval: 45, window: { enabled: false } } })");          // back to what the later checks expect
    await run(sw, "document.querySelector('#tab-general').click()");

    // ---- credit and links ----
    check('credit footer names the author and links to GitHub and LinkedIn', await run(sw, `(() => { const f = document.querySelector('.brandbar'); const l = f.querySelector('a[data-link=linkedin]'), g = f.querySelector('a[data-link=repo]'); return f.textContent.includes(${JSON.stringify(Brand.author)}) && l.href === ${JSON.stringify(Brand.linkedinUrl)} && g.href === ${JSON.stringify(Brand.repoUrl)}; })()`));
    check('credit footer visible on every tab', await run(sw, "(async () => { for (const t of ['characters','reminders','sounds','general']) { document.querySelector('#tab-' + t).click(); await new Promise(r => setTimeout(r, 80)); const r = document.querySelector('.brandbar').getBoundingClientRect(); if (r.height < 20 || r.bottom > innerHeight + 1) return false; } return true; })()"));
    const urlBefore = sw.webContents.getURL();
    await run(sw, "document.querySelector('.brandbar a[data-link=linkedin]').click()"); await sleep(600);
    check('clicking the LinkedIn link opens it in the browser, not in the app', opened.includes(Brand.linkedinUrl) && sw.webContents.getURL() === urlBefore, opened);
    check('an arbitrary address cannot be opened', await run(sw, "sipSettings.openLink('https://evil.example/phish').then(r => r.ok === false)") && await run(sw, "sipSettings.openLink('../../etc/passwd').then(r => r.ok === false)") && await run(sw, "sipSettings.openLink(['repo']).then(r => r.ok === false)") && await run(sw, "sipSettings.openLink({ toString() { return 'repo'; } }).then(r => r.ok === false, () => true)") && !opened.some(u => /evil|passwd/.test(u)));
    for (const k of ['repo', 'issues', 'github']) await run(sw, `sipSettings.openLink('${k}')`);
    check('exactly the four configured https addresses can be opened', [Brand.repoUrl, Brand.issuesUrl, Brand.profileUrl, Brand.linkedinUrl].every(u => u.startsWith('https://') && opened.includes(u)) && opened.every(u => [Brand.repoUrl, Brand.issuesUrl, Brand.profileUrl, Brand.linkedinUrl].includes(u)), opened);
    await run(sw, "document.querySelector('#tab-sounds').click()"); await sleep(300); await shot(sw, 'settings-sounds');
    await run(sw, "document.querySelector('#tab-general').click()"); await sleep(300); await shot(sw, 'settings-general');
    await run(sw, "document.querySelector('#tab-reminders').click()"); await sleep(300); await shot(sw, 'settings-reminders-full');
    await run(sw, "document.querySelector('#tab-characters').click()");

    // ---- security ----
    check('no network: fetch is blocked', await run(sw, "fetch('https://example.com').then(() => false, () => true)"));
    const before = sw.webContents.getURL(); await run(sw, "location.href = 'https://example.com'").catch(() => 0); await sleep(800);
    check('cannot navigate away', sw.webContents.getURL() === before);
    check('cannot open new windows', await run(sw, "window.open('https://example.com') === null") && BrowserWindow.getAllWindows().length === 2);
    check('overlay cannot reach the settings bridge', await run(overlay, "typeof window.sipSettings === 'undefined'"));
    check('settings cannot reach the overlay bridge', await run(sw, "typeof window.sip === 'undefined'"));
    const csp = consoleMsgs.filter(m => /Content Security Policy|Refused to/i.test(m.msg) && !/example\.com/.test(m.msg));   // example.com is this test's own deliberate attack
    check('no content-security-policy violations', csp.length === 0, csp.slice(0, 3));
    const bad = consoleMsgs.filter(m => /deprecat/i.test(m.msg)); check('no deprecation warnings from the page', bad.length === 0, bad.slice(0, 3));
    const st = JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8'));
    check('state file saved with names, reminders and water', st.hero.name && st.pet.name === 'Mochi' && st.reminders.length === 2 && st.water.interval === 45);
    check('state file is owner-only', process.platform === 'win32' || (fs.statSync(path.join(DATA, 'state.json')).mode & 0o077) === 0, (fs.statSync(path.join(DATA, 'state.json')).mode & 0o777).toString(8));
  } catch (e) { check('test run completed without exceptions', false, String(e && e.stack || e)); }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${results.length - failed} passed, ${failed} failed`);
  fs.writeFileSync('/tmp/selftest.json', JSON.stringify({ results, consoleMsgs: consoleMsgs.slice(-40) }, null, 1));
  app.exit(failed ? 1 : 0);
});
