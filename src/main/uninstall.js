'use strict';
// "Uninstall completely": works out exactly what to delete, refuses anything that does not look like Sip's own files, and
// hands the deleting to a small detached helper that runs after Sip has quit (a running program cannot delete itself).
// No Electron APIs here, so plan() can be tested on its own. Paths are decided here and never taken from a window.
const path = require('path');
const fs = require('fs');

const PRODUCT = 'Sip Water Buddy';
const PKG_NAME = 'sip-water-buddy';

const real = {
  exists: p => { try { fs.accessSync(p); return true; } catch (e) { return false; } },
  isDir: p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } },
  // true when `dir` (or its resources/app) holds the package.json of this app
  isSipFolder: dir => ['package.json', path.join('resources', 'app', 'package.json')].some(rel => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')).name === PKG_NAME; } catch (e) { return false; }
  }),
  hasGit: dir => { try { return fs.existsSync(path.join(dir, '.git')); } catch (e) { return false; } },
};

// Never delete a drive root, the home folder, or any folder that contains the home folder.
function safeToDelete(dir, home, pathMod = path) {
  if (typeof dir !== 'string' || !pathMod.isAbsolute(dir)) return false;
  const d = pathMod.resolve(dir);
  if (pathMod.parse(d).root === d) return false;
  const h = pathMod.resolve(home);
  const rel = pathMod.relative(d, h);                                       // '' = same, no '..' = d contains home
  if (rel === '' || (!rel.startsWith('..') && !pathMod.isAbsolute(rel))) return false;
  return d.split(pathMod.sep).filter(Boolean).length >= 3;
}

// ctx: { platform, appDir, home, userData, isPackaged, execPath, env }. deps (optional) replaces the file checks in tests.
function plan(ctx, deps = {}) {
  const d = { ...real, ...deps };
  const pm = ctx.platform === 'win32' ? path.win32 : path.posix;
  const env = ctx.env || {};
  const out = { ok: true, remove: [], uninstaller: null, lines: [], warnings: [], reason: '' };
  const addDir = (dir, label) => {
    if (!d.exists(dir)) return;
    if (!safeToDelete(dir, ctx.home, pm)) { out.ok = false; out.reason = `Refusing to delete ${dir}: it is not a safe place to remove automatically.`; return; }
    out.remove.push(dir); out.lines.push(label + ': ' + dir);
  };
  const addFile = (file, label) => { if (d.exists(file)) { out.remove.push(file); out.lines.push(label + ': ' + file); } };

  if (ctx.platform === 'linux') {
    const dataHome = env.XDG_DATA_HOME || pm.join(ctx.home, '.local', 'share'), configHome = env.XDG_CONFIG_HOME || pm.join(ctx.home, '.config');
    if (d.isSipFolder(ctx.appDir)) {
      addDir(ctx.appDir, ctx.isPackaged || ctx.appDir === pm.join(dataHome, PKG_NAME) ? 'Program' : 'This project folder');
      if (d.hasGit(ctx.appDir)) out.warnings.push('This folder is a Git checkout. Any changes you made in it will be lost.');
    }
    addFile(pm.join(dataHome, 'applications', PKG_NAME + '.desktop'), 'Launcher');
    addFile(pm.join(configHome, 'autostart', PKG_NAME + '.desktop'), 'Start-at-sign-in entry');
    addFile(pm.join(ctx.home, '.cache', PKG_NAME + '.log'), 'Log');
  } else if (ctx.platform === 'win32') {
    const execDir = pm.dirname(ctx.execPath || '');
    const portable = env.PORTABLE_EXECUTABLE_FILE;
    const uninstaller = pm.join(execDir, 'Uninstall ' + PRODUCT + '.exe');
    if (portable) { addFile(portable, 'Portable program'); }
    else if (ctx.isPackaged && d.exists(uninstaller)) { out.uninstaller = uninstaller; out.lines.push('Program and shortcuts: removed by its own uninstaller'); }
    else if (ctx.isPackaged && d.isSipFolder(execDir)) {
      addDir(execDir, 'Program folder');
      if (env.APPDATA) addFile(pm.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT + '.lnk'), 'Start menu shortcut');
    } else if (!ctx.isPackaged && d.isSipFolder(ctx.appDir)) {
      addDir(ctx.appDir, 'This project folder');
      if (d.hasGit(ctx.appDir)) out.warnings.push('This folder is a Git checkout. Any changes you made in it will be lost.');
    }
  }
  if (ctx.userData) addDir(ctx.userData, 'Your reminders, settings and added files');

  // The helper builds a shell command from these paths on Windows, so characters that command.com treats specially are refused.
  if (ctx.platform === 'win32') for (const p of out.remove.concat(out.uninstaller ? [out.uninstaller] : [])) {
    if (/["%^!&|<>]/.test(p)) { out.ok = false; out.reason = 'A path contains a special character (' + p + '). Remove Sip by hand instead (see the README).'; }
  }
  if (!out.remove.length && !out.uninstaller && out.ok) { out.ok = false; out.reason = 'Nothing to remove was found.'; }
  return out;
}

// Starts the detached helper. Call just before quitting; it waits a few seconds so Sip has fully exited first.
function launch(p, spawn, platform) {
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  if (platform === 'win32') {
    const parts = ['ping -n 5 127.0.0.1 >nul'];
    if (p.uninstaller) parts.push(`start "" /wait "${p.uninstaller}" /S`);
    for (const f of p.remove) parts.push(`(rmdir /s /q "${f}" 2>nul || del /f /q "${f}" 2>nul)`);
    spawn('cmd.exe', ['/d', '/s', '/c', `"${parts.join(' & ')}"`], { ...opts, windowsVerbatimArguments: true }).unref();
  } else {
    // paths travel as arguments, not inside the script text
    spawn('sh', ['-c', 'sleep 3; rm -rf -- "$@"', 'sip-uninstall', ...p.remove], opts).unref();
  }
}

module.exports = { plan, launch, safeToDelete, PRODUCT };
