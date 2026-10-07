'use strict';
// `npm run test:e2e`: launches the real app under a virtual display and drives it (Linux; needs xvfb). Takes a few minutes in software rendering.
const { spawnSync } = require('child_process');
const path = require('path');
if (process.platform !== 'linux') { console.log('The end-to-end test runs on Linux (it uses xvfb). In CI it runs on ubuntu-latest.'); process.exit(0); }
const electron = require('./ensure-electron')();
const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', electron, '--no-sandbox', '--ozone-platform=x11', '--disable-gpu', path.resolve(__dirname, '..', 'tests', 'e2e', 'selftest.js')], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
