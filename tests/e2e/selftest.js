'use strict';
// End-to-end check: launches the real app (main process, both windows, real preload scripts) and drives it.
//   xvfb-run -a electron --no-sandbox --disable-gpu tests/e2e/selftest.js
const { app, BrowserWindow, shell } = require('electron');
const Brand = require('../../src/main/branding.js');
const opened = []; shell.openExternal = async u => { opened.push(u); };       // never open a real browser during the test
const path = require('path'), fs = require('fs');
const DATA = '/tmp/sip-selftest-data', SHOTS = process.env.SIP_SHOTS_DIR || '/tmp/shots';
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
app.setPath('userData', DATA);
const results = [], consoleMsgs = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); };
app.on('web-contents-created', (_e, wc) => wc.on('console-message', ev => consoleMsgs.push({ level: ev.level, msg: String(ev.message).slice(0, 300) })));
require(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 60000, step = 300) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } if (Date.now() - t0 > ms) return false; await sleep(step); } }
const win = title => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() === title);
const run = (w, code) => w.webContents.executeJavaScript(code, true);
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
