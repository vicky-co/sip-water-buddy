'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const Core = require('../shared/core.js');
const Brand = require('./branding.js');
const Uninstall = require('./uninstall.js');
const APP_VERSION = require('../../package.json').version;

const isWin = process.platform === 'win32', isLinux = process.platform === 'linux';
const APP_DIR = path.resolve(__dirname, '..', '..');                       // project root (resources/app in the Windows build)
const RENDERER = path.join(APP_DIR, 'src', 'renderer');
const ICON = path.join(APP_DIR, 'assets', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const WIN_W = 470, WIN_H = 420, HERO_X = 150, GROUND = 15;     // window size; hero centre and feet inside the window (same numbers as the character window)
const DEBUG = !!process.env.SIP_DEBUG;
// Links the Settings window may open in the person's browser. The window sends only a key; the address comes from here, https only.
const LINKS = Object.freeze({ repo: Brand.repoUrl, issues: Brand.issuesUrl, github: Brand.profileUrl, linkedin: Brand.linkedinUrl });

// ---------- Chromium switches ----------
if (isLinux) {
  // Ubuntu runs GNOME on Wayland, which does not let apps stay on top or move freely: use XWayland (X11) instead.
  // The display backend is chosen before any script runs, so it must be on the real command line (a switch added here is too late
  // on newer Electron, which then picks Wayland and the characters never appear). If it is missing, restart once with it.
  if (!process.argv.some(a => a.startsWith('--ozone-platform'))) {
    app.relaunch({ args: process.argv.slice(1).concat('--ozone-platform=x11') });
    app.exit(0);
  }
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// If the graphics card cannot do WebGL (old drivers, virtual machines, remote desktop) fall back to software WebGL
// instead of silently dropping to the cartoon look. Only this app's own local files are ever rendered.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.SIP_NO_GPU || process.argv.includes('--no-gpu')) app.disableHardwareAcceleration();   // for graphics drivers that draw a black box
if (isWin) app.setAppUserModelId('com.sip.waterbuddy');
Menu.setApplicationMenu(null);

// ---------- Log file (userData/sip.log): no terminal needed to see what happened ----------
const logFile = () => path.join(app.getPath('userData'), 'sip.log');
(function setupLog() {
  const orig = { log: console.log, error: console.error };
  let ready = false;
  const write = (lvl, args) => {
    try {
      if (!ready) {
        fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
        try { if (fs.statSync(logFile()).size > 200000) fs.writeFileSync(logFile(), ''); } catch (e) { /* no log yet */ }
        ready = true;
      }
      const text = args.map(a => (a && a.stack) || (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      fs.appendFileSync(logFile(), `${new Date().toISOString()} ${lvl} ${text}\n`, { mode: 0o600 });
    } catch (e) { /* logging must never break the app */ }
  };
  console.log = (...a) => { orig.log(...a); write('INFO', a); };
  console.error = (...a) => { orig.error(...a); write('ERROR', a); };
})();
process.on('uncaughtException', err => console.error('Sip error:', err));

// ---------- Saved state ----------
let S = Core.normalize({});
const userDir = sub => path.join(app.getPath('userData'), sub);
const statePath = () => path.join(app.getPath('userData'), 'state.json');
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (uninstalling) return;
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true, mode: 0o700 });
    const tmp = statePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(S), { mode: 0o600 });
    fs.renameSync(tmp, statePath());                      // atomic: a crash can never leave a half-written file
  } catch (e) { console.error('Could not save settings:', e); }
}
let uninstalling = false;     // once removal has started, nothing may write the settings folder again
const save = () => { if (!uninstalling && !saveTimer) saveTimer = setTimeout(saveNow, 200); };
function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { /* first run or unreadable: use defaults */ }
  S = Core.normalize(raw, Date.now(), () => crypto.randomUUID());
  rollover(); Core.catchUp(S, Date.now());
  // one-time: the folder for added 3D pets used to be called "dogs"
  try { if (fs.existsSync(userDir('dogs')) && !fs.existsSync(userDir('pets'))) fs.renameSync(userDir('dogs'), userDir('pets')); } catch (e) { /* ignore */ }
  saveNow();
}
function rollover() { if (Core.rollover(S)) save(); }        // also files the finished day in the history for the 30-day statistics

// ---------- Characters and sounds: built-in and added by the person ----------
const BUILTIN = {
  hero: [{ id: 'default', label: '3D avatar (default)' }, { id: '2d', label: 'Cartoon' }],
  pet: [{ id: 'golden', label: 'Golden Retriever (3D)', file: 'golden-retriever.glb' }, { id: 'gsd', label: 'German Shepherd (3D)', file: 'german-shepherd.glb' }, { id: '2d', label: 'Cartoon pet' }],
  sound: [{ id: 'synth', label: 'Synth woof', one: 0.3 }, { id: 'bigdog', label: 'Big dog', file: 'bigdog.mp3', one: 0.3 }, { id: 'excited', label: 'Excited barking', file: 'excited.mp3', one: 0.28 },
    { id: 'pug', label: 'Pug', file: 'pug.mp3', one: 0.45 }, { id: 'woofs', label: 'Rapid woofs', file: 'woofs.mp3', one: 0.4 }],
};
const KINDS = {
  avatar: { dir: 'avatars', exts: ['.glb'], max: 150 * 1024 * 1024, title: 'Choose a 3D avatar', filter: { name: '3D avatar (.glb)', extensions: ['glb'] }, glb: true },
  pet: { dir: 'pets', exts: ['.glb'], max: 150 * 1024 * 1024, title: 'Choose a 3D pet', filter: { name: '3D pet (.glb)', extensions: ['glb'] }, glb: true },
  sound: { dir: 'barks', exts: ['.mp3', '.wav', '.ogg'], max: 10 * 1024 * 1024, title: 'Choose a pet sound', filter: { name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }, glb: false },
};
const SAFE_FILE = /^[\p{L}\p{M}\p{N} ._()\-]{1,100}$/u;
function listUser(kind) {
  const K = KINDS[kind];
  try { return fs.readdirSync(userDir(K.dir)).filter(f => K.exts.some(e => f.toLowerCase().endsWith(e)) && SAFE_FILE.test(f)).sort(); } catch (e) { return []; }
}
const looksFor = kind => [...BUILTIN[kind === 'avatar' ? 'hero' : kind === 'pet' ? 'pet' : 'sound'].map(({ id, label }) => ({ id, label })),
  ...listUser(kind).map(f => ({ id: 'file:' + f, label: f.replace(/\.[^.]+$/, ''), user: true }))];
// Resolves an id to a file path inside our own folders, or null. Added files are looked up by bare file name only.
function assetPath(kind, id) {
  let p = null;
  if (typeof id === 'string' && id.startsWith('file:')) {
    if (!Core.FILE[kind].test(id)) return null;
    p = path.join(userDir(KINDS[kind].dir), path.basename(id.slice(5)));
  } else if (kind === 'avatar' && id === 'default') p = path.join(APP_DIR, 'assets', 'models', 'avatar.glb');
  else if (kind === 'pet') { const b = BUILTIN.pet.find(x => x.id === id && x.file); if (b) p = path.join(APP_DIR, 'assets', 'models', 'pets', b.file); }
  else if (kind === 'sound') { const b = BUILTIN.sound.find(x => x.id === id && x.file); if (b) p = path.join(APP_DIR, 'assets', 'sounds', b.file); }
  return p;
}
const assetExists = (kind, id) => { const p = assetPath(kind, id); try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; } };
function readAsset(kind, id) {
  const p = assetPath(kind, id); if (!p) return null;
  try { const st = fs.statSync(p); if (!st.isFile() || st.size > KINDS[kind].max) return null; return fs.readFileSync(p); } catch (e) { return null; }
}
const soundOne = id => { const b = BUILTIN.sound.find(x => x.id === id); return b ? b.one : 0.6; };

async function addFile(kind) {
  const K = KINDS[kind]; if (!K) return { ok: false, error: 'Unknown file type.' };
  const r = await dialog.showOpenDialog(settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined, { title: K.title, properties: ['openFile'], filters: [K.filter] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
  if (!K.exts.includes(ext)) return { ok: false, error: 'That file type is not supported.' };
  let st; try { st = fs.statSync(src); } catch (e) { return { ok: false, error: 'Could not read that file.' }; }
  if (!st.isFile() || st.size === 0 || st.size > K.max) return { ok: false, error: 'That file is empty or too large (limit ' + Math.round(K.max / 1048576) + ' MB).' };
  if (K.glb) {   // a .glb starts with "glTF" and version 2
    const fd = fs.openSync(src, 'r'), head = Buffer.alloc(12);
    try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
    if (head.toString('latin1', 0, 4) !== 'glTF' || head.readUInt32LE(4) !== 2) return { ok: false, error: 'That does not look like a .glb 3D model.' };
  }
  let name = path.basename(src).replace(/[^\p{L}\p{M}\p{N} ._()\-]/gu, '_').slice(-100);
  if (!SAFE_FILE.test(name)) name = 'file' + ext;
  const dir = userDir(K.dir); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = name.slice(0, -ext.length); let final = name, i = 2;
  while (fs.existsSync(path.join(dir, final))) final = `${base} (${i++})${ext}`;
  fs.copyFileSync(src, path.join(dir, final));
  return { ok: true, id: 'file:' + final };
}
function removeFile(kind, id) {
  const p = (id || '').startsWith('file:') ? assetPath(kind, id) : null; if (!p) return false;
  try { fs.unlinkSync(p); } catch (e) { return false; }
  if (kind === 'avatar' && S.hero.look === id) S.hero.look = 'default';
  if (kind === 'pet' && S.pet.look === id) S.pet.look = 'golden';
  if (kind === 'sound' && S.pet.sound === id) S.pet.sound = 'bigdog';
  return true;
}

// ---------- Start when I sign in ----------
const linuxInstalled = () => isLinux && APP_DIR === path.join(os.homedir(), '.local', 'share', 'sip-water-buddy');
const autostartSupported = () => (isWin && app.isPackaged) || linuxInstalled();
function applyLogin() {
  if (!autostartSupported()) return;
  try {
    if (isWin) app.setLoginItemSettings({ openAtLogin: S.startAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });   // the portable build runs from a temp folder; point at the real file
    else {
      const f = path.join(os.homedir(), '.config', 'autostart', 'sip-water-buddy.desktop');
      if (S.startAtLogin) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Sip Water Buddy\nExec="${process.execPath}" "${APP_DIR}" --no-sandbox --ozone-platform=x11\nIcon=${path.join(APP_DIR, 'assets', 'icons', 'icon.png')}\nX-GNOME-Autostart-enabled=true\n`);
      } else fs.rmSync(f, { force: true });
    }
  } catch (e) { console.error('Could not change start-at-sign-in:', e); }
}

// ---------- Security for every window ----------
const isOurPage = u => { try { const p = new URL(u); return p.protocol === 'file:' && path.resolve(fileURLToPath(p)).startsWith(APP_DIR + path.sep); } catch (e) { return false; } };
const fromWin = (e, w) => !!w && !w.isDestroyed() && e.sender === w.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame && isOurPage(e.senderFrame.url);
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', ev => ev.preventDefault());
  wc.on('will-redirect', ev => ev.preventDefault());
  wc.on('will-attach-webview', ev => ev.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});
const SAFE_PREFS = () => ({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
  experimentalFeatures: false, spellcheck: false, navigateOnDragDrop: false, devTools: DEBUG });
function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // This app needs no network at all: refuse every web request.
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_d, cb) => cb({ cancel: true }));
}

// ---------- Windows ----------
let overlay = null, settingsWin = null, tray = null;
let busy = false, active = null, waterNextAt = 0, ticks = 0;
const renderStatus = { hero: 'starting…', pet: 'starting…' };

function overlayPayload() {
  const heroLook = (S.hero.look === 'default' || S.hero.look === '2d' || assetExists('avatar', S.hero.look)) ? S.hero.look : 'default';
  const petLook = (S.pet.look === '2d' || assetExists('pet', S.pet.look)) ? S.pet.look : 'golden';
  const petSound = (S.pet.sound === 'synth' || assetExists('sound', S.pet.sound)) ? S.pet.sound : 'bigdog';
  return { names: { hero: S.hero.name, pet: S.pet.name }, show: S.show, heroLook, petLook, petFlip: S.pet.flip, petSound, petSoundOne: soundOne(petSound), petSpeed: S.pet.speed, sound: { ...S.sound }, behavior: { ...S.behavior } };
}
const pushOverlay = () => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('settings', overlayPayload()); };

function createOverlay() {
  overlay = new BrowserWindow({
    width: WIN_W, height: WIN_H, transparent: true, frame: false, backgroundColor: '#00000000', hasShadow: false,
    // Linux needs resizable for setBounds to work; on Windows a resizable transparent window can stop being transparent
    resizable: isLinux, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: true, title: 'Sip',
    webPreferences: { ...SAFE_PREFS(), preload: path.join(APP_DIR, 'src', 'preload', 'overlay-preload.js'), backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (!isWin) overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadFile(path.join(RENDERER, 'overlay', 'index.html'));
  overlay.webContents.on('console-message', (...args) => {          // Electron 35+ passes one event object; older versions pass arguments
    const ev = args[0], msg = ev && typeof ev.message === 'string' ? ev.message : args[2];
    console.log('[characters]', msg);
  });
  overlay.webContents.on('render-process-gone', (_e, d) => {
    console.error('Character window crashed:', d.reason);
    busy = false; active = null;
    try { overlay.destroy(); } catch (e) { /* already gone */ }
    setTimeout(createOverlay, 1500);
  });
  overlay.webContents.on('did-fail-load', (_e, code, desc) => { console.error('Character window failed to load:', code, desc); openSettings(); });
  overlay.webContents.once('did-finish-load', () => {
    console.log('Character window loaded.');
    pushOverlay();
    if (S.water.enabled && Core.inWaterWindow(S.water.window, Date.now())) setTimeout(() => appear('intro', { type: 'water' }), 1200);   // quiet outside the chosen hours
  });
}

// Window position that puts the hero's feet on `spot`, kept inside the screen that is nearest to it.
function spotWindow(spot) {
  const a = screen.getDisplayNearestPoint({ x: spot.x, y: spot.y }).workArea;
  const clampTo = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return { x: Math.round(clampTo(spot.x - HERO_X, a.x, a.x + a.width - WIN_W)), y: Math.round(clampTo(spot.y - (WIN_H - GROUND), a.y, a.y + a.height - WIN_H)) };
}
function appear(kind, item) {
  if ((busy && !(active && active.type === 'todos')) || !overlay || overlay.isDestroyed()) return false;       // an open to-do list gives way to a check-in
  busy = true; active = item || { type: 'water' };
  console.log(`Check-in (${kind}: ${active.type}) at ${new Date().toLocaleTimeString()}`);
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  let x = Math.round(wa.x + 40 + Math.random() * Math.max(0, wa.width - WIN_W - 80)), y = wa.y + wa.height - WIN_H;
  const parked = S.behavior.parked && S.behavior.spot ? spotWindow(S.behavior.spot) : null;     // the person's chosen waiting place
  if (parked) { x = parked.x; y = parked.y; }
  overlay.setPosition(x, y); overlay.showInactive(); overlay.setAlwaysOnTop(true, 'screen-saver');
  const out = { type: active.type };
  if (active.type === 'todo') Object.assign(out, { id: active.id, title: active.title, note: active.note || '', late: !!active.late });
  if (active.type === 'reminder') Object.assign(out, { id: active.id, title: active.title, note: active.note || '', late: !!active.late, preview: !!active.preview });
  if (active.type === 'hello') out.preview = true;
  overlay.webContents.send('appear', { kind, item: out, wa, parked: !!parked, areas: screen.getAllDisplays().map(d => d.workArea), start: { x, y },
    count: S.count, goal: S.water.goal, interval: S.water.interval, waterEnabled: S.water.enabled, settings: overlayPayload() });
  refreshUi();
  return true;
}
function askNow() { return appear('ask', S.water.enabled ? { type: 'water' } : { type: 'hello' }); }
function testReminder(id) {
  const r = S.reminders.find(x => x.id === id); if (!r) return false;
  return appear('ask', { type: 'reminder', id: r.id, title: r.title, note: r.note, preview: true });
}
function finish(info) {
  info = info && typeof info === 'object' ? info : {};
  const clean = { type: ['water', 'reminder', 'todo', 'todos', 'hello'].includes(info.type) ? info.type : 'hello', id: typeof info.id === 'string' ? info.id.slice(0, 40) : '',
    action: ['done', 'skip', 'snooze'].includes(info.action) ? info.action : '', minutes: Number.isFinite(info.minutes) ? info.minutes : undefined, preview: info.preview === true };
  rollover();
  waterNextAt = Core.gateWater(S, Core.applyFinish(S, clean, Date.now(), waterNextAt, () => crypto.randomUUID()), Date.now());
  busy = false; active = null;
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  save(); refreshUi();
}

const SETTINGS_PAGE = path.join(RENDERER, 'settings', 'index.html');
function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) { if (settingsWin.isMinimized()) settingsWin.restore(); settingsWin.show(); settingsWin.focus(); if (tab) settingsWin.webContents.send('settings:navigate', tab); return; }
  settingsWin = new BrowserWindow({
    width: 940, height: 700, minWidth: 760, minHeight: 540, show: false, title: 'Sip Settings', autoHideMenuBar: true,
    backgroundColor: '#f6f8fa', icon: ICON,
    webPreferences: { ...SAFE_PREFS(), preload: path.join(APP_DIR, 'src', 'preload', 'settings-preload.js') },
  });
  settingsWin.removeMenu();
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus(); if (tab) settingsWin.webContents.send('settings:navigate', tab); });
  settingsWin.on('closed', () => { settingsWin = null; });
  settingsWin.loadFile(SETTINGS_PAGE);
}

// ---------- What the settings window sees ----------
function viewState() {
  return {
    now: Date.now(), version: APP_VERSION, electron: process.versions.electron, platform: process.platform,
    show: S.show, hero: { ...S.hero }, pet: { ...S.pet }, sound: { ...S.sound }, startAtLogin: S.startAtLogin, autostartSupported: autostartSupported(), behavior: { ...S.behavior },
    features: { ...S.features }, todoRemind: { ...S.todoRemind }, today: { ...S.today, count: S.count, goal: S.water.goal }, dayLog: S.dayLog.slice().sort((a, b) => a.t - b.t), todos: S.todos.map(t => ({ ...t, dueAt: Core.dueAt(t.due), overdue: Core.isOverdue(t, Date.now()) })), stats: Core.stats(S),
    water: { ...S.water, count: S.count, nextAt: S.water.enabled ? waterNextAt : null },
    heroLooks: looksFor('avatar'), petLooks: looksFor('pet'), petSounds: looksFor('sound'),
    reminders: S.reminders.map(r => ({ ...r, describe: Core.describe(r) })),
    diag: { ...renderStatus }, logPath: logFile(),
    about: { name: Brand.appName, author: Brand.author, license: Brand.license, links: LINKS },
  };
}
function pushSettingsState() { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', viewState()); }
function notify(msg) { console.log('Notice:', msg); if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:notice', String(msg).slice(0, 200)); }

const fmtWhen = ts => {
  const d = new Date(ts), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + t;
};
function buildTray() {
  if (!tray) return;
  const next = Core.nextEvent(S, waterNextAt);
  const items = [];
  if (S.water.enabled) items.push({ label: `Water today: ${S.count} of ${S.water.goal} glasses`, enabled: false });
  items.push({ label: busy ? 'Checking in now' : next ? `Next: ${next.label} at ${fmtWhen(next.at)}` : 'No reminders scheduled', enabled: false });
  items.push({ type: 'separator' });
  if (S.features.todos) items.push({ label: 'Quick add todo…', click: () => openQuickAdd() });                // first, so it is one click from the icon
  items.push({ label: 'Open Settings…', click: () => openSettings() },
    { label: 'Add a reminder…', click: () => openSettings('reminders-add') });
  if (S.features.todos) {
    const open = S.todos.filter(t => !t.done).length, late = S.todos.filter(t => Core.isOverdue(t, Date.now())).length;
    items.push({ label: open ? `Show todos (${open} open${late ? ', ' + late + ' overdue' : ''})` : 'Show todos', click: () => showTodos() });
  }
  items.push({ label: 'Show me now', click: () => askNow() });
  if (S.water.enabled) items.push({ label: 'I just had water', click: () => { rollover(); S.count = Math.min(999, S.count + 1); S.log.push(Date.now()); S.log = S.log.slice(-200); Core.logAction(S, { t: Date.now(), type: 'water', title: 'Water (tray)', action: 'done', minutes: S.water.interval, interval: S.water.interval }, crypto.randomUUID()); waterNextAt = Core.gateWater(S, Date.now() + S.water.interval * 60000, Date.now()); save(); refreshUi(); } });
  items.push({ type: 'separator' }, { label: 'Uninstall Sip completely…', click: () => { uninstallEverything(); } }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(S.water.enabled ? `Sip: ${S.count} of ${S.water.goal} glasses today` : 'Sip');
}
function refreshUi() {
  buildTray(); pushSettingsState();
  if (busy && active && active.type === 'todos' && overlay && !overlay.isDestroyed()) overlay.webContents.send('todos', todoPayload());   // keep the list on the desktop in step
}

// ---------- Messages from the character window (checked: right window, right page, right shape) ----------
const fromOverlay = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromWin(e, overlay)) fn(...a); });
const handleOverlay = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromWin(e, overlay)) throw new Error('blocked'); return fn(...a); });
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
fromOverlay('move', (x, y, w, h) => {
  if (!overlay || overlay.isDestroyed()) return;
  const b = { x: num(x, -100000, 100000, 0), y: num(y, -100000, 100000, 0), width: num(w, 100, 20000, WIN_W), height: num(h, 100, 20000, WIN_H) };
  overlay.setBounds(b);
  if (isWin) { const g = overlay.getBounds(); if (g.width !== b.width || g.height !== b.height) overlay.setBounds(b); }   // mixed-DPI screens can change the size
  if (b.width > WIN_W) overlay.focus();                                                                                    // so Esc works while aiming
});
fromOverlay('click-through', ignore => { if (isWin && overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(ignore === true, { forward: true }); });
fromOverlay('done', info => finish(info));
fromOverlay('open-settings', () => openSettings());
fromOverlay('status', st => {
  const o = st && typeof st === 'object' ? st : {};
  for (const k of ['hero', 'pet']) if (typeof o[k] === 'string') renderStatus[k] = o[k].slice(0, 120);
  console.log('Status:', JSON.stringify(renderStatus)); pushSettingsState();
});
fromOverlay('set-setting', patch => {      // the speech bubble can only change the mute switch and the pet's speed
  const p = patch && typeof patch === 'object' ? patch : {}, safe = {};
  if (p.sound && typeof p.sound.mute === 'boolean') safe.sound = { mute: p.sound.mute };
  if (p.pet && p.pet.speed !== undefined) safe.pet = { speed: p.pet.speed };
  if (p.behavior && typeof p.behavior === 'object') {          // the "wait here" button: where to wait, and whether to keep waiting there
    safe.behavior = {};
    if ('spot' in p.behavior) safe.behavior.spot = p.behavior.spot;
    if ('parked' in p.behavior) safe.behavior.parked = p.behavior.parked;
    if ('todoSpot' in p.behavior) safe.behavior.todoSpot = p.behavior.todoSpot;
  }
  if (Core.applyPatch(S, safe).changed.length) { save(); pushSettingsState(); }
});
fromOverlay('avatar-error', (id, msg) => {
  console.error('Avatar failed:', String(id).slice(0, 120), String(msg).slice(0, 200));
  if (S.hero.look === id && id !== 'default') { S.hero.look = 'default'; save(); pushOverlay(); notify("Couldn't use that avatar (" + String(msg).slice(0, 100) + '). Using the default.'); }
  refreshUi();
});
fromOverlay('pet-error', (id, msg) => {
  console.error('Pet model failed:', String(id).slice(0, 120), String(msg).slice(0, 200));
  if (S.pet.look === id) { S.pet.look = id === 'golden' ? '2d' : 'golden'; save(); pushOverlay(); notify("Couldn't use that pet (" + String(msg).slice(0, 100) + '). Switched to a built-in one.'); }
  refreshUi();
});
handleOverlay('load-avatar', id => readAsset('avatar', id));
handleOverlay('load-pet', id => readAsset('pet', id));
handleOverlay('load-sound', id => readAsset('sound', id));
handleOverlay('log-glass', () => { rollover(); S.count = Math.min(999, S.count + 1); S.log.push(Date.now()); S.log = S.log.slice(-200); save(); refreshUi(); return { count: S.count, goal: S.water.goal }; });

// ---------- Messages from the settings window ----------
const handleSettings = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => { if (!fromWin(e, settingsWin)) throw new Error('blocked'); return fn(...a); });
handleSettings('settings:get', () => viewState());
handleSettings('settings:patch', patch => {
  const win = () => JSON.stringify(S.water.window);
  const before = { interval: S.water.interval, enabled: S.water.enabled, login: S.startAtLogin, win: win() };
  const r = Core.applyPatch(S, patch);
  if (r.changed.length) {
    const now = Date.now();
    if (S.water.enabled !== before.enabled || S.water.interval !== before.interval) waterNextAt = Core.gateWater(S, now + S.water.interval * 60000, now);
    else if (win() !== before.win) waterNextAt = Core.rescheduleWater(S, waterNextAt, now);     // editing the hours: asks resume or move to match
    if (S.startAtLogin !== before.login) applyLogin();
    save(); pushOverlay(); refreshUi();
  }
  return { rejected: r.rejected, view: viewState() };
});
handleSettings('settings:add-file', async kind => {
  if (!KINDS[typeof kind === 'string' ? kind : '']) return { ok: false, error: 'Unknown file type.' };
  const r = await addFile(kind);
  if (r.ok) {
    if (kind === 'avatar') S.hero.look = r.id; else if (kind === 'pet') S.pet.look = r.id; else S.pet.sound = r.id;
    save(); pushOverlay(); refreshUi();
    if (kind !== 'sound') setTimeout(() => appear('ask', { type: 'hello' }), 800);    // show the new character right away
  }
  return { ...r, view: viewState() };
});
handleSettings('settings:remove-file', (kind, id) => {
  const ok = KINDS[typeof kind === 'string' ? kind : ''] && typeof id === 'string' && removeFile(kind, id);
  if (ok) { save(); pushOverlay(); refreshUi(); }
  return { ok: !!ok, view: viewState() };
});
handleSettings('settings:play-sound', id => { if (overlay && !overlay.isDestroyed() && (id === 'synth' || assetExists('sound', id))) overlay.webContents.send('test-sound', id); return true; });
handleSettings('settings:reminder-add', input => {
  if (S.reminders.length >= Core.MAX_REMINDERS) return { ok: false, error: 'That is the maximum number of reminders.', view: viewState() };
  const r = Core.makeReminder(input, Date.now(), crypto.randomUUID());
  if (r.ok) { S.reminders.push(r.reminder); save(); refreshUi(); }
  return { ok: r.ok, error: r.error, view: viewState() };
});
handleSettings('settings:reminder-update', (id, patch) => {
  const i = S.reminders.findIndex(r => r.id === id); if (i < 0) return { ok: false, error: 'Reminder not found.', view: viewState() };
  const r = Core.updateReminder(S.reminders[i], patch, Date.now());
  if (r.ok) { S.reminders[i] = r.reminder; save(); refreshUi(); }
  return { ok: r.ok, error: r.error, view: viewState() };
});
handleSettings('settings:reminder-delete', id => { const n = S.reminders.length; S.reminders = S.reminders.filter(r => r.id !== id); if (S.reminders.length !== n) { save(); refreshUi(); } return viewState(); });
handleSettings('settings:reminder-clear-done', () => { S.reminders = S.reminders.filter(r => !r.done); save(); refreshUi(); return viewState(); });
handleSettings('settings:reminder-test', id => ({ ok: testReminder(id) }));
handleSettings('settings:water', op => {
  const o = op && typeof op === 'object' ? op : {}; rollover();
  if (o.reset === true) { S.count = 0; S.log = []; S.today = { skips: 0, skipMin: 0, snoozes: 0, snoozeMin: 0 }; S.dayLog = S.dayLog.filter(e => e.type !== 'water'); } else if (Number.isInteger(o.delta)) S.count = Math.max(0, Math.min(999, S.count + Math.max(-5, Math.min(5, o.delta))));
  save(); refreshUi(); return viewState();
});
handleSettings('settings:ask-now', () => ({ ok: askNow() }));
handleSettings('settings:open-link', async key => {
  const url = (typeof key === 'string' && Object.prototype.hasOwnProperty.call(LINKS, key)) ? LINKS[key] : null;
  if (!url || !url.startsWith('https://')) return { ok: false };
  try { await shell.openExternal(url); return { ok: true }; } catch (e) { console.error('Could not open link:', e); return { ok: false }; }
});
handleSettings('settings:open-log', async () => { await shell.openPath(logFile()); return true; });

// ---------- To-do list ----------
const todoView = () => viewState();
function todoAdd(text, due, remind) {
  if (!S.features.todos) return { ok: false, error: 'The to-do list is switched off in Settings > General.' };
  if (due !== undefined && due !== null && typeof due !== 'string') return { ok: false, error: 'Pick a valid deadline.' };
  const r = Core.addTodo(S, typeof text === 'string' ? text : '', Date.now(), crypto.randomUUID(), typeof due === 'string' ? due : undefined, remind);
  if (r.ok) { save(); refreshUi(); }
  return r;
}
handleSettings('settings:todo-due', (id, due) => { const r = Core.setTodoDue(S, typeof id === 'string' ? id.slice(0, 40) : '', typeof due === 'string' ? due : null); if (r.ok) { save(); refreshUi(); } return { ok: r.ok, error: r.error || '', view: todoView() }; });
handleSettings('settings:todo-remind', (id, remind) => { const r = Core.setTodoRemind(S, typeof id === 'string' ? id.slice(0, 40) : '', remind); if (r.ok) { save(); refreshUi(); } return { ok: r.ok, error: r.error || '', view: todoView() }; });
handleSettings('settings:todo-add', (text, due, remind) => { const r = todoAdd(text, due, remind); return { ok: r.ok, error: r.error || '', view: todoView() }; });
handleSettings('settings:todo-done', (id, done) => { const r = Core.setTodoDone(S, typeof id === 'string' ? id.slice(0, 40) : '', done === true, Date.now()); if (r.ok) { save(); refreshUi(); } return { ok: r.ok, view: todoView() }; });
handleSettings('settings:todo-delete', id => { const ok = Core.deleteTodo(S, typeof id === 'string' ? id.slice(0, 40) : ''); if (ok) { save(); refreshUi(); } return { ok, view: todoView() }; });
handleSettings('settings:todo-clear-done', () => { const n = Core.clearDoneTodos(S); if (n) { save(); refreshUi(); } return { ok: true, cleared: n, view: todoView() }; });

// "Due Mon 3 Nov at 17:00" / "Overdue: ..." for the line under a to-do reminder
function dueNote(t, now) {
  const at = Core.dueAt(t.due); if (at == null) return '';
  const hasT = t.due.length > 10, d = new Date(+t.due.slice(0, 4), +t.due.slice(5, 7) - 1, +t.due.slice(8, 10), hasT ? +t.due.slice(11, 13) : 0, hasT ? +t.due.slice(14, 16) : 0);
  const when = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + (t.due.length > 10 ? ' at ' + t.due.slice(11) : '');
  return (at < now ? 'Overdue: ' : 'Due ') + when;
}

// ---------- The to-do list on the desktop: the hero and pet appear and hold the list; it can be dragged anywhere ----------
let todoShownAt = 0;
function todoPayload() {
  const now = Date.now();
  return S.todos.map(t => ({ id: t.id, text: t.text, done: t.done, due: t.due, dueAt: Core.dueAt(t.due), overdue: Core.isOverdue(t, now) }))
    .sort((a, b) => (a.done - b.done) || ((a.dueAt == null) - (b.dueAt == null)) || ((a.dueAt || 0) - (b.dueAt || 0)));
}
function showTodos() {
  if (!S.features.todos) { openSettings('general'); return false; }
  if (!overlay || overlay.isDestroyed() || (busy && !(active && active.type === 'todos'))) { openSettings('todos'); return false; }   // a check-in is on screen: use Settings instead
  busy = true; active = { type: 'todos' }; todoShownAt = Date.now();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  let x = wa.x + wa.width - WIN_W - 40, y = wa.y + wa.height - WIN_H;
  if (S.behavior.todoSpot) { const sp = spotWindow(S.behavior.todoSpot); x = sp.x; y = sp.y; }
  console.log(`Showing the to-do list (${S.todos.filter(t => !t.done).length} open)`);
  overlay.setPosition(x, y); overlay.showInactive(); overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.webContents.send('appear', { kind: 'todos', item: { type: 'todos', todos: todoPayload() }, wa, areas: screen.getAllDisplays().map(d => d.workArea), start: { x, y },
    count: S.count, goal: S.water.goal, interval: S.water.interval, waterEnabled: S.water.enabled, settings: overlayPayload() });
  refreshUi();
  return true;
}
handleSettings('settings:show-todos', () => ({ ok: showTodos() }));
handleOverlay('todo-set', (id, done) => {
  if (S.features.todos) { const r = Core.setTodoDone(S, typeof id === 'string' ? id.slice(0, 40) : '', done === true, Date.now()); if (r.ok) { save(); refreshUi(); } }
  return todoPayload();
});

// ---------- Today's answered check-ins: edit them (after asking) ----------
handleSettings('settings:log-edit', async (id, action) => {
  id = typeof id === 'string' ? id.slice(0, 40) : ''; action = ['done', 'skip', 'snooze', 'delete'].includes(action) ? action : '';
  rollover();
  const pv = Core.previewLogEdit(S, id, action);
  if (!pv.ok) return { ok: false, error: pv.error, view: viewState() };
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  const r = await dialog.showMessageBox(parent, { type: 'question', title: 'Update today’s list?', message: pv.message, detail: pv.detail, buttons: [action === 'delete' ? 'Remove it' : 'Update', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
  if (r.response !== 0) return { ok: false, cancelled: true, view: viewState() };
  const res = Core.editLogEntry(S, id, action, Date.now());
  if (res.ok) { save(); refreshUi(); }
  return { ok: res.ok, error: res.error || '', view: viewState() };
});

// A small window to jot a to-do down from the tray menu
let quickWin = null;
function openQuickAdd() {
  if (!S.features.todos) { openSettings('general'); return; }
  if (quickWin && !quickWin.isDestroyed()) { quickWin.show(); quickWin.focus(); return; }
  quickWin = new BrowserWindow({
    width: 460, height: 250, resizable: false, minimizable: false, maximizable: false, alwaysOnTop: true, show: false, title: 'Sip Quick Add',
    autoHideMenuBar: true, backgroundColor: '#f6f8fa', icon: ICON,
    webPreferences: { ...SAFE_PREFS(), preload: path.join(APP_DIR, 'src', 'preload', 'quickadd-preload.js') },
  });
  quickWin.removeMenu();
  quickWin.once('ready-to-show', () => { quickWin.show(); quickWin.focus(); });
  quickWin.on('closed', () => { quickWin = null; });
  quickWin.loadFile(path.join(RENDERER, 'quickadd', 'index.html'));
}
ipcMain.handle('quick:add', (e, text, due, remind) => {
  if (!fromWin(e, quickWin)) throw new Error('blocked');
  const r = todoAdd(text, due, remind); return { ok: r.ok, error: r.error || '', open: S.todos.filter(t => !t.done).length };
});
ipcMain.on('quick:close', e => { if (fromWin(e, quickWin)) quickWin.close(); });

// ---------- Uninstall completely ----------
// Asked for from Settings or the tray. The paths come from uninstall.js (never from a window), the person confirms in a native dialog,
// and the actual deleting is done by a helper that runs after Sip has quit.
async function uninstallEverything() {
  const plan = Uninstall.plan({ platform: process.platform, appDir: APP_DIR, home: os.homedir(), userData: app.getPath('userData'),
    isPackaged: app.isPackaged, execPath: process.execPath, env: process.env });
  const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
  if (!plan.ok) { await dialog.showMessageBox(parent, { type: 'info', title: 'Uninstall Sip', message: "Sip can't remove itself automatically here.", detail: plan.reason + '\n\nSee "Uninstall completely" in the README for the manual steps.', buttons: ['OK'] }); return { ok: false, reason: plan.reason }; }
  const r = await dialog.showMessageBox(parent, { type: 'warning', title: 'Uninstall Sip completely', buttons: ['Uninstall completely', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
    message: 'Remove Sip from this computer?',
    detail: 'This permanently deletes:\n\n' + plan.lines.join('\n') + (plan.warnings.length ? '\n\n' + plan.warnings.join('\n') : '') + '\n\nThis cannot be undone.' });
  if (r.response !== 0) return { ok: false, cancelled: true };
  console.log('Uninstalling:', JSON.stringify(plan.remove), plan.uninstaller || '');
  uninstalling = true; clearTimeout(saveTimer); saveTimer = null;
  try { S.startAtLogin = false; applyLogin(); } catch (e) { console.error('Could not turn off start-at-sign-in:', e); }
  if (isWin) try { app.setLoginItemSettings({ openAtLogin: false }); } catch (e) { /* not set */ }
  try { Uninstall.launch(plan, require('child_process').spawn, process.platform); }
  catch (e) { uninstalling = false; console.error('Could not start the removal helper:', e); await dialog.showMessageBox(parent, { type: 'error', message: 'Could not start the removal.', detail: String(e.message || e), buttons: ['OK'] }); return { ok: false }; }
  setTimeout(() => app.exit(0), 300);
  return { ok: true };
}
handleSettings('settings:uninstall', () => uninstallEverything());

// While a check-in is on screen, tell the character window where the mouse is (it stops walking when the mouse is over a character).
setInterval(() => {
  if (!busy || !overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  overlay.webContents.send('cursor', screen.getCursorScreenPoint());
}, 70);

// ---------- Start-up ----------
if (!app.requestSingleInstanceLock()) {
  console.log('Sip is already running (water-drop icon near the clock). Opening its Settings instead.');
  app.exit(0);
}
app.on('second-instance', () => { openSettings(); });
app.on('before-quit', saveNow);
app.on('window-all-closed', () => { /* stay running in the tray */ });

app.whenReady().then(() => {
  lockDownSession();
  load();
  waterNextAt = Core.gateWater(S, Date.now() + S.water.interval * 60000, Date.now());
  console.log(`Sip started (${process.platform}, Electron ${process.versions.electron}). Water ${S.water.enabled ? 'every ' + S.water.interval + ' min' : 'off'}; ${S.reminders.length} custom reminder(s).`);
  console.log(`Session: type=${process.env.XDG_SESSION_TYPE || '?'} wayland=${process.env.WAYLAND_DISPLAY || '-'} display=${process.env.DISPLAY || '-'} args=${process.argv.slice(1).join(' ')}`);
  applyLogin();
  tray = new Tray(ICON);
  if (isWin) tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', () => openSettings());
  buildTray();
  setTimeout(createOverlay, 400);                       // short delay helps transparency on Linux compositors
  setInterval(() => {
    const now = Date.now(); rollover();
    const gated = Core.gateWater(S, waterNextAt, now); if (gated !== waterNextAt) { waterNextAt = gated; buildTray(); }       // the window closed or opened: the next ask is reset to its opening
    if (!busy || (active && active.type === 'todos' && now - todoShownAt > 5 * 60000)) {
      const item = Core.pickNext(S, waterNextAt, now);
      if (item) {
        const r = item.type === 'reminder' ? S.reminders.find(x => x.id === item.id) : null;
        const td = item.type === 'todo' ? S.todos.find(x => x.id === item.id) : null;
        if (td) { if (appear('ask', { type: 'todo', id: td.id, title: td.text, note: dueNote(td, now), late: item.late })) { td.reminded = now; td.snoozeUntil = null; save(); } }
        else appear('ask', r ? { type: 'reminder', id: r.id, title: r.title, note: r.note, late: now - r.nextAt > 90000 } : item);
      }
    } else if (overlay && !overlay.isDestroyed()) { overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.moveTop(); }   // stay above other windows until answered
    if (++ticks % 12 === 0) refreshUi();
  }, 5000);
});
