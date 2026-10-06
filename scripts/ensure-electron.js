'use strict';
// Electron 44+ no longer downloads its runtime during `npm install`. This fetches it the first time it is needed.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
module.exports = function electronPath() {
  const dir = path.dirname(require.resolve('electron/package.json'));
  const bin = path.join(dir, 'dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  if (!fs.existsSync(bin)) {
    console.log('Downloading the Electron runtime (one time only)...');
    const r = spawnSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
    if (r.status !== 0 || !fs.existsSync(bin)) { console.error('Could not download Electron. Check your internet connection and try again.'); process.exit(1); }
  }
  return bin;
};
