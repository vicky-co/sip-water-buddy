#!/usr/bin/env bash
# Builds dist/sip-water-buddy-<version>-windows-x64.zip: Electron for Windows + the app + Install.bat. Works from Linux, macOS or WSL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
ELECTRON="$(node -p "require('electron/package.json').version")"
[ -f src/renderer/vendor/three-bundle.js ] || npm run build:vendor
DL="$ROOT/dist/electron-win32"; STAGE="$ROOT/dist/stage-win/SipWaterBuddy"
rm -rf "$DL" "$ROOT/dist/stage-win"; mkdir -p "$DL" "$STAGE"
# 1) the Windows build of Electron (npm only downloads the matching platform when asked to)
( cd "$DL" && echo '{"name":"sip-electron-win32","private":true}' > package.json && npm_config_platform=win32 npm_config_arch=x64 npm install "electron@$ELECTRON" --no-fund --no-audit --ignore-scripts >/dev/null \
  && npm_config_platform=win32 npm_config_arch=x64 node node_modules/electron/install.js )
cp -r "$DL/node_modules/electron/dist/." "$STAGE/"
mv "$STAGE/electron.exe" "$STAGE/Sip Water Buddy.exe"; rm -f "$STAGE/resources/default_app.asar"
( cd "$STAGE/locales" && for f in *.pak; do case "$f" in en-US.pak|en-GB.pak) ;; *) rm -f "$f";; esac; done )
# 2) the app
APPDIR="$STAGE/resources/app"; mkdir -p "$APPDIR"
cp -r src assets "$APPDIR/"
node -e "const p=require('./package.json');require('fs').writeFileSync(process.argv[1],JSON.stringify({name:p.name,version:p.version,description:p.description,main:p.main,author:p.author,license:p.license,homepage:p.homepage,repository:p.repository,bugs:p.bugs,private:true},null,2)+'\n')" "$APPDIR/package.json"
# 3) installer scripts, icon, licences
cp scripts/windows/* "$STAGE/"; cp assets/icons/icon.ico "$STAGE/icon.ico"; cp LICENSE "$STAGE/LICENSE-Sip.txt"; cp THIRD_PARTY_NOTICES.md "$STAGE/"
OUTZ="$ROOT/dist/sip-water-buddy-$VERSION-windows-x64.zip"; rm -f "$OUTZ"
(cd "$ROOT/dist/stage-win" && zip -qr -9 "$OUTZ" SipWaterBuddy)
rm -rf "$DL"
echo "Built $OUTZ"
