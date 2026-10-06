# Changelog
All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.1] - 2026-10-07
### Added
- **Windows installer** (`Sip-Water-Buddy-Setup-<version>.exe`, per-user, no admin rights) and a single-file **portable exe**, built by GitHub Actions on Windows with the water-drop icon. Uninstall from Settings → Apps.
- `--no-gpu` command-line option for graphics drivers that draw a black box.

### Changed
- The release workflow builds Windows on a Windows runner and publishes the installer and portable exe. The older zip + `Install.bat` route remains available as `npm run package:win-zip` but is no longer published.
- GitHub Actions moved to current major versions.

### Fixed
- Start-at-sign-in now points at the real file when running the portable build.

## [2.0.0] - 2026-10-06
### Added
- **Settings window** with Characters, Reminders, Sounds and General tabs, replacing the tray dropdowns.
- **Custom reminders**: one-time (date and time), daily, certain days of the week, or repeating every N minutes/hours; quick-add chips; edit, pause, test, delete; *Done / +10 min / +1 hour / Skip*. Missed one-time reminders still fire; stale repeating ones skip ahead.
- **Water reminder can be turned off** and now has its own interval, goal and daily counter controls.
- **Names** for the hero and the pet, used in speech and buttons.
- **Hide the hero or the pet** (never both): hero + pet, hero only, or pet only. In pet-only mode the pet acts out the hero's moves.
- **Generic pet**: wording and code are no longer dog-specific. Built-in Golden Retriever (rigged, animated) and German Shepherd, plus *Add a 3D pet*.
- **Windows build** and installer scripts; Linux installer rewritten.
- **Credit footer** in Settings with links to the repository and LinkedIn; *About* card with star / connect / report-a-bug links.
- Open-source project structure: CI, release automation, issue and PR templates, docs.

### Changed
- Runtime moved from Electron 33 (end of life) to **Electron 44**.
- Source reorganised into `src/main`, `src/preload`, `src/renderer`, `src/shared`; the three.js bundle is generated at install time.
- Walk cycle swings both arms.

### Security
- Strict Content-Security-Policy with no inline code; sandbox, context isolation, no Node in windows; DevTools off.
- Every IPC message is sender-checked and schema-validated; all web requests blocked; navigation, new windows and permission requests denied.
- Added files validated (extension, size, glTF header) and stored under sanitised names; links open only from a fixed allowlist.
- Owner-only file permissions and atomic saves.
- Removed deprecated APIs (`console-message` positional arguments, `webkitAudioContext`).

### Fixed
- Pet bone poses could accumulate frame by frame and spin the pet; now applied per frame and undone.
- File names containing combining marks (for example Devanagari) were rejected.
- Schedule fields could remain visible when hidden; speech bubble could be clipped at the top of the window.

## [1.0.0]
- First version: animated hero with a dog, water reminders, Ubuntu desktop app.
