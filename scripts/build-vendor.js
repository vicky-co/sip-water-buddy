'use strict';
// Bundles the 3D library (three.js + its glTF loader) into one script the character window loads.
// Generated at install time (npm "prepare") so the repository does not carry a large minified file.
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'src', 'renderer', 'vendor', 'three-bundle.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
esbuild.buildSync({
  stdin: { contents: "import * as THREE from 'three'; import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; window.SIP3D = { THREE, GLTFLoader };", resolveDir: root, loader: 'js' },
  bundle: true, minify: true, format: 'iife', target: 'chrome130', legalComments: 'eof', outfile: out,
});
console.log('Built', path.relative(root, out), Math.round(fs.statSync(out).size / 1024) + ' KB');
