# Releasing

Releases are built by GitHub Actions when you push a version tag. Everyone then downloads from the **Releases** page.

## Before the first public release (one-time checklist)
- [ ] **Asset licences**: fill in `assets/README.md` for every model and sound (source, author, licence) and make sure you are allowed to redistribute them. If you are not sure about one, remove it and its entry in `BUILTIN` (the cartoon looks always work).
- [ ] Repository **Settings → General**: add a description and topics (e.g. `electron`, `desktop-pet`, `reminders`, `threejs`).
- [ ] **Settings → Code security**: enable *Private vulnerability reporting* (SECURITY.md points to it), *Dependabot alerts* and *Dependabot security updates*.
- [ ] **Settings → Branches**: protect `main` (require the CI checks to pass before merging).
- [ ] Check the repository name matches the URLs in `src/main/branding.js`, `package.json`, `README.md` and `SECURITY.md` (default: `vicky-co/sip-water-buddy`).
- [ ] Optional: pin the actions in `.github/workflows` to commit SHAs.

## Cutting a release
1. Update `CHANGELOG.md`: move *Unreleased* entries under a new version heading with today's date.
2. Bump the version: `npm version 2.1.0 --no-git-tag-version`, then commit (`git commit -am "Release 2.1.0"`).
3. Tag and push: `git tag v2.1.0 && git push origin main v2.1.0`.
4. The **Release** workflow checks the tag matches `package.json`, runs lint and unit tests, then builds in parallel:
   the **Windows installer** (`Sip-Water-Buddy-Setup-<version>.exe`) and **portable exe** on a GitHub Windows runner (with the water-drop icon embedded),
   and the **Linux zip** on Ubuntu. A final job writes `SHA256SUMS.txt` and creates the GitHub release with generated notes. Edit the notes if you like.

## Building by hand
```bash
npm ci
npm run package:linux   # dist/sip-water-buddy-<version>-linux.zip (any OS)
npm run package:win     # dist/installer/*.exe (run on Windows)
npm run package:win-zip # optional: the older zip + Install.bat route; works from Linux, not published by the workflow
```
The Windows installer is not code-signed, so Windows shows its "protected your PC" prompt. A code-signing certificate (or the free
[SignPath Foundation](https://signpath.org/) programme for open-source projects) removes it.

## Verifying a download
```bash
sha256sum -c SHA256SUMS.txt
```
