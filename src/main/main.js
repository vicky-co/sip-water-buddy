'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const Core = require('../shared/core.js');
const Brand = require('./branding.js');
const APP_VERSION = require('../../package.json').version;

const isWin = process.platform === 'win32', isLinux = process.platform === 'linux';
const APP_DIR = path.resolve(__dirname, '..', '..');                       // project root (resources/app in the Windows build)
const RENDERER = path.join(APP_DIR, 'src', 'renderer');
const ICON = path.join(APP_DIR, 'assets', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const WIN_W = 470, WIN_H = 420;
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
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true, mode: 0o700 });
    const tmp = statePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(S), { mode: 0o600 });
    fs.renameSync(tmp, statePath());                      // atomic: a crash can never leave a half-written file
  } catch (e) { console.error('Could not save settings:', e); }
}
const save = () => { if (!saveTimer) saveTimer = setTimeout(saveNow, 200); };
function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { /* first run or unreadable: use defaults */ }
  S = Core.normalize(raw, Date.now(), () => crypto.randomUUID());
  rollover(); Core.catchUp(S, Date.now());
  // one-time: the folder for added 3D pets used to be called "dogs"
  try { if (fs.existsSync(userDir('dogs')) && !fs.existsSync(userDir('pets'))) fs.renameSync(userDir('dogs'), userDir('pets')); } catch (e) { /* ignore */ }
  saveNow();
}
function rollover() { const t = Core.todayStr(); if (S.date !== t) { S.date = t; S.count = 0; S.log = []; save(); } }

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
  return { names: { hero: S.hero.name, pet: S.pet.name }, show: S.show, heroLook, petLook, petFlip: S.pet.flip, petSound, petSoundOne: soundOne(petSound), petSpeed: S.pet.speed, sound: { ...S.sound } };
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
    if (S.water.enabled) setTimeout(() => appear('intro', { type: 'water' }), 1200);
  });
}

function appear(kind, item) {
  if (busy || !overlay || overlay.isDestroyed()) return false;
  busy = true; active = item || { type: 'water' };
  console.log(`Check-in (${kind}: ${active.type}) at ${new Date().toLocaleTimeString()}`);
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = Math.round(wa.x + 40 + Math.random() * Math.max(0, wa.width - WIN_W - 80)), y = wa.y + wa.height - WIN_H;
  overlay.setPosition(x, y); overlay.showInactive(); overlay.setAlwaysOnTop(true, 'screen-saver');
  const out = { type: active.type };
  if (active.type === 'reminder') Object.assign(out, { id: active.id, title: active.title, note: active.note || '', late: !!active.late, preview: !!active.preview });
  if (active.type === 'hello') out.preview = true;
  overlay.webContents.send('appear', { kind, item: out, wa, areas: screen.getAllDisplays().map(d => d.workArea), start: { x, y },
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
  const clean = { type: ['water', 'reminder', 'hello'].includes(info.type) ? info.type : 'hello', id: typeof info.id === 'string' ? info.id.slice(0, 40) : '',
    action: ['done', 'skip', 'snooze'].includes(info.action) ? info.action : '', minutes: Number.isFinite(info.minutes) ? info.minutes : undefined, preview: info.preview === true };
  waterNextAt = Core.applyFinish(S, clean, Date.now(), waterNextAt);
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
    show: S.show, hero: { ...S.hero }, pet: { ...S.pet }, sound: { ...S.sound }, startAtLogin: S.startAtLogin, autostartSupported: autostartSupported(),
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
  items.push({ type: 'separator' },
    { label: 'Open Settings…', click: () => openSettings() },
    { label: 'Add a reminder…', click: () => openSettings('reminders-add') },
    { label: 'Show me now', click: () => askNow() });
  if (S.water.enabled) items.push({ label: 'I just had water', click: () => { rollover(); S.count = Math.min(999, S.count + 1); S.log.push(Date.now()); S.log = S.log.slice(-200); waterNextAt = Date.now() + S.water.interval * 60000; save(); refreshUi(); } });
  items.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(S.water.enabled ? `Sip: ${S.count} of ${S.water.goal} glasses today` : 'Sip');
}
function refreshUi() { buildTray(); pushSettingsState(); }

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
  const before = { interval: S.water.interval, enabled: S.water.enabled, login: S.startAtLogin };
  const r = Core.applyPatch(S, patch);
  if (r.changed.length) {
    if (S.water.enabled !== before.enabled || S.water.interval !== before.interval) waterNextAt = Date.now() + S.water.interval * 60000;
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
  if (o.reset === true) { S.count = 0; S.log = []; } else if (Number.isInteger(o.delta)) S.count = Math.max(0, Math.min(999, S.count + Math.max(-5, Math.min(5, o.delta))));
  save(); refreshUi(); return viewState();
});
handleSettings('settings:ask-now', () => ({ ok: askNow() }));
handleSettings('settings:open-link', async key => {
  const url = (typeof key === 'string' && Object.prototype.hasOwnProperty.call(LINKS, key)) ? LINKS[key] : null;
  if (!url || !url.startsWith('https://')) return { ok: false };
  try { await shell.openExternal(url); return { ok: true }; } catch (e) { console.error('Could not open link:', e); return { ok: false }; }
});
handleSettings('settings:open-log', async () => { await shell.openPath(logFile()); return true; });

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
  waterNextAt = Date.now() + S.water.interval * 60000;
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
    if (!busy) {
      const item = Core.pickNext(S, waterNextAt, now);
      if (item) {
        const r = item.type === 'reminder' ? S.reminders.find(x => x.id === item.id) : null;
        appear('ask', r ? { type: 'reminder', id: r.id, title: r.title, note: r.note, late: now - r.nextAt > 90000 } : item);
      }
    } else if (overlay && !overlay.isDestroyed()) { overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.moveTop(); }   // stay above other windows until answered
    if (++ticks % 12 === 0) refreshUi();
  }, 5000);
});
