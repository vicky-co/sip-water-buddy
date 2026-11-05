# Changelog
All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.3.0] - 2026-11-05
### Added
- **To-do deadlines**, optional, with a date and an optional time (Settings, Quick add, and editable in the list). Overdue items are marked in red and counted in the tray menu.
- **Deadline reminders**: the hero and pet remind you before a deadline (Done, +10 min, +1 hour, Skip). A global "remind me N minutes before" setting, and a per-to-do choice that can differ or switch it off. A deadline without a time counts from 09:00 that day. Deadlines that passed more than 2 hours ago are shown as overdue but do not pop up.
- **Show todos on the desktop**: the tray's *Show todos* (and a button in Settings) makes the hero and pet appear and hold your list. They do not move; tick items off right there; drag them (or the strip above the list) anywhere, and Sip remembers the spot. A check-in that falls due takes over after 5 minutes.
- **Today tab**: every check-in answered today (water, reminders, to-dos) with a status you can change (Done, Skipped, Not yet) or remove. Each change is confirmed in a dialog that says what will change, and the glass count and skip totals follow. The list starts fresh each day.
- **Water window** (Settings → Reminders): ask only between a start and an end time, also across midnight. After the end the next ask is reset to the start; editing the hours later (longer window, earlier start, switching it off) resumes or moves the asks immediately.
### Changed
- Runtime updated from Electron 44 to **Electron 45** (45.2.1). Tested with the full end-to-end suite on a fresh install.
### Fixed
- A mouse pointer that is simply resting where the hero and pet appear no longer pauses them. Hovering pauses them only after the pointer has moved onto them (before, a resting pointer could keep the start-up greeting from ever showing its question).
- The credit bar in Settings stays at the bottom of the window; only the tab content scrolls.
- A to-do deadline of the wrong type sent to the app was silently dropped instead of refused.

## [2.2.0] - 2026-11-04
### Added
- **To-do list**, switched on or off in Settings → General. A **To-dos** tab (add, tick, delete, clear completed) and two tray menu items: **Show todos** (with the number still open) and **Quick add todo…**, which opens a small window so you can jot one down without opening Settings.
- **Stats tab**: the last 30 days of water as charts: glasses per day against your goal, deviation from the goal (glasses above or below), and skipped time, plus summary tiles and a table of the numbers. Sip now keeps a small daily history (up to 120 days) on your computer; days before this version, or when Sip was not running, show as empty.
- Skipped and "Not yet" water check-ins are counted (with their minutes) for the statistics.

## [2.1.1] - 2026-10-24
### Fixed
- **Go now and the goodbye message appear the moment you answer.** Before, tapping *I drank* left the old question on screen with no buttons while the first pose (about 3 seconds) played, and Go now only showed up afterwards.
### Changed
- The Release workflow can also be started by hand from the Actions tab (on `main`); it then publishes the version in `package.json` and creates its tag.

## [2.1.0] - 2026-10-23
### Added
- **The question now appears the moment the characters land** and follows them while they walk (it used to wait until they had finished a full lap). You can answer straight away.
- **Hovering stops them**: while the mouse is over the hero, pet or message they stand still; they carry on when it moves away.
- **Leave time after answering** (Settings → General): right away, quick, normal or a custom 1-60 seconds. The goodbye message has a **⏩ Go now** button.
- **Wait here**: a 📍 button in the message lets you click a spot on any screen and they walk there and wait. The spot is remembered; **📌 Always wait here** (or Settings → General) uses it for every check-in, **🚶 Roam again** goes back to random places.
- **Uninstall completely from inside the app** (Settings → General and the tray menu): lists what will be deleted, asks first, then removes the program (or the folder it runs from), shortcuts, start-at-sign-in entry, saved data and logs.
- **Windows without an installer**: `Start Sip (Windows, from folder).bat` runs Sip straight from the project folder (Node.js fetches Electron, so no downloaded `.exe` is involved), and the release now also includes `sip-water-buddy-<version>-windows-x64.zip`, a prebuilt folder with `Start Sip.bat`. For PCs that block unsigned installers.
- **`uninstall.sh` for Linux** (installed to `~/.local/share/sip-water-buddy/` and included in the Linux zip): removes the program, launcher, start-at-sign-in entry, saved data and logs; `--keep-data` keeps your settings. The README now documents complete removal on Windows and Linux.

## [2.0.2] - 2026-10-07
### Fixed
- **Ubuntu (Wayland): only the tray icon appeared, no hero or pet.** The X11 display mode is now passed on the real command line in every launch path (installer, start script, autostart, `npm start`), and Sip restarts itself once with it if it was missing.
- Settings opens if the character window cannot load, and `sip.log` now records the session type, display and launch arguments.

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
