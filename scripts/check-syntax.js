'use strict';
// `npm run lint`: every JavaScript file must at least parse. (Keeps the repo dependency-free for linting.)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const skip = new Set(['node_modules', 'dist', '.git', 'vendor']);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); } })(root);
let bad = 0;
for (const f of files) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error('Syntax error in', path.relative(root, f), '\n', String(e.stderr || e.message)); } }
console.log(`${files.length - bad} of ${files.length} files OK`);
process.exit(bad ? 1 : 0);
