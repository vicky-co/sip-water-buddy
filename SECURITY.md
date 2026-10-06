# Security policy

## Reporting a vulnerability
Please **do not** open a public issue for security problems.
Use GitHub's private reporting: **Security → Report a vulnerability** on this repository
(<https://github.com/vicky-co/sip-water-buddy/security/advisories/new>). If that is unavailable, message the maintainer on
[LinkedIn](https://www.linkedin.com/in/pareshsethy1) asking for a private channel, without posting details publicly.

Include what you found, how to reproduce it, and the version (Settings → General). You will get an acknowledgement as soon as
the maintainer sees it, and credit in the release notes if you want it.

## Supported versions
Only the latest release receives fixes.

## Security model in brief
- **No network**: every web request from the app is cancelled; Sip needs none.
- **Windows are locked down**: context isolation on, Node integration off, renderer sandbox on, DevTools off, navigation and new windows blocked, all permission requests denied.
- **Strict CSP** on both pages: only the app's own scripts and styles; no inline code, no remote resources.
- **Narrow bridges**: each window gets a short list of named functions. The main process verifies the sender (right window, right page) and validates every value before using it.
- **Files you add** (`.glb`, audio) are checked (type, size, header), stored under safe generated names inside Sip's own folder, and only read.
- **External links** use a fixed allowlist of `https` addresses; windows send a key, never a URL.
- **Data at rest**: settings and logs are written with owner-only permissions; settings are saved atomically.
- **Dependencies** are few (Electron, three.js at build time) and tracked by Dependabot; Electron is kept on a supported major version.

## Known limitation
Ubuntu 24.04 restricts the helper Electron uses for its OS-level sandbox, so on Linux Sip starts with `--no-sandbox`.
The other protections above still apply, and the app loads only its own local files.
