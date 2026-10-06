# Contributing to Sip Water Buddy

Thanks for helping! This is a small project; the process is light.

## Ways to help
- **Report a bug** or **suggest a feature**: use the issue templates. For bugs, include your OS, the Sip version
  (Settings → General) and the log (Settings → General → *Open log file*).
- **Fix or improve something**: fork, branch, change, open a pull request.
- **Add looks**: new 3D pets/avatars or sounds are welcome *only* with a clear licence (see below).

## Set up
```bash
git clone https://github.com/<you>/sip-water-buddy.git && cd sip-water-buddy
npm ci && npm start
```
Node.js 20+ required. Run `npm run lint` and `npm test` before every pull request. On Linux you can also run `npm run test:e2e`.

## Ground rules (these protect users)
Sip runs on people's own computers, so a few rules are non-negotiable:

1. **No network access.** Do not add code that makes web requests, loads remote scripts/fonts/images, or phones home.
2. **No inline code in windows.** Pages use a strict Content-Security-Policy (`script-src 'self'`, `style-src 'self'`). No inline `<script>`, `style=""`, `eval`, or `new Function`.
3. **No Node in the windows.** Keep `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. New abilities go through a named function in a preload file, never the raw IPC object.
4. **Treat every message from a window as untrusted.** Check the sender (`fromWin`), validate the shape and values (`src/shared/core.js`), and clamp ranges in the main process.
5. **Text from users is text.** Show names and reminder titles with `textContent`, never `innerHTML`.
6. **External links** go through the allowlist in `main.js` (`LINKS`): the window sends a key, never a URL.
7. **Added files** (models, sounds) are validated, copied, and only read. Never execute them.

## Code style
- Plain modern JavaScript (no framework, no TypeScript build). 2-space indent, semicolons, single quotes.
- Prefer small pure functions in `src/shared/core.js` for logic you can unit test.
- Comments explain *why*; avoid restating the code.
- Keep the UI accessible: labels for inputs, visible focus, keyboard operation, `prefers-reduced-motion` respected.

## Tests
- Logic changes need a test in `tests/core.test.js` (it runs in several time zones in CI-minded fashion; avoid assumptions about the local zone).
- UI/IPC changes should be covered in `tests/e2e/selftest.js`.

## Pull requests
- One focused change per PR; describe what and why; link the issue.
- Update `CHANGELOG.md` under *Unreleased*.
- New assets: add a row to `assets/README.md` with source, author and licence, and keep files small (a few MB).
  Do not submit models or sounds you do not have the right to share, or anything depicting a real person's likeness.

By contributing you agree your contribution is released under the project's [MIT licence](LICENSE).
