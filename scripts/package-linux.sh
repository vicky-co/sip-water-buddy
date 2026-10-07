#!/usr/bin/env bash
# Builds dist/sip-water-buddy-<version>-linux.zip: the app plus an installer (needs Node 20+ and internet once on the user's machine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
ELECTRON="$(node -p "require('electron/package.json').version")"
[ -f src/renderer/vendor/three-bundle.js ] || npm run build:vendor
STAGE="dist/stage-linux/sip-water-buddy"; rm -rf dist/stage-linux; mkdir -p "$STAGE"
cp -r src assets "$STAGE/"; cp LICENSE THIRD_PARTY_NOTICES.md "$STAGE/"
cp scripts/linux/install.sh scripts/linux/start.sh scripts/linux/uninstall.sh "$STAGE/"; chmod +x "$STAGE/install.sh" "$STAGE/start.sh" "$STAGE/uninstall.sh"
# The installed copy needs only Electron, pinned to the exact version this release was tested with.
node -e "const p=require('./package.json');require('fs').writeFileSync(process.argv[1],JSON.stringify({name:p.name,version:p.version,description:p.description,main:p.main,author:p.author,license:p.license,homepage:p.homepage,repository:p.repository,bugs:p.bugs,private:true,dependencies:{electron:process.argv[2]}},null,2)+'\n')" "$STAGE/package.json" "$ELECTRON"
OUTZ="$ROOT/dist/sip-water-buddy-$VERSION-linux.zip"; rm -f "$OUTZ"
(cd dist/stage-linux && zip -qr -9 "$OUTZ" sip-water-buddy)
echo "Built $OUTZ"
