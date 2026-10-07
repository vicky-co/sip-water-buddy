'use strict';
// `npm start`: runs the app from source. On Linux it adds --no-sandbox (Ubuntu 24.04 blocks Electron's sandbox helper).
const { spawn } = require('child_process');
const path = require('path');
const electron = require('./ensure-electron')();   // path to the electron binary (downloads it on first run)
const args = [path.resolve(__dirname, '..')];
if (process.platform === 'linux') args.push('--no-sandbox', '--ozone-platform=x11');
const child = spawn(electron, args, { stdio: 'inherit' });
child.on('exit', code => process.exit(code === null ? 1 : code));
