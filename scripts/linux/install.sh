#!/usr/bin/env bash
# Installs Sip from the release zip into ~/.local/share/sip-water-buddy, adds an app-grid launcher and start-at-sign-in,
# and starts it in the background. Safe to run again to update; your settings and reminders are kept.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/.local/share/sip-water-buddy"

if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js and npm (needs your password once)..."
  sudo apt update && sudo apt install -y nodejs npm
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Your Node.js is version $NODE_MAJOR; Sip's runtime needs 20 or newer (22 recommended)."
  echo "Install a newer one (for example: https://nodejs.org or 'sudo snap install node --classic') and run this again."
  exit 1
fi

# Stop any running copy (only Sip's own Electron process)
pkill -f "electron.*sip-water-buddy" 2>/dev/null || true
sleep 1

mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  # Replace the old program files (keeps node_modules so updates are quick). Your data lives elsewhere (~/.config/sip-water-buddy).
  case "$APP" in */sip-water-buddy) find "$APP" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + ;; esac
  tar -C "$SRC" --exclude=./node_modules --exclude=./install.sh -cf - . | tar -C "$APP" -xf -
fi
chmod +x "$APP/start.sh"

cd "$APP"
npm install --no-fund --no-audit
# Electron 44+ no longer downloads its program during npm install, so fetch it explicitly
if [ ! -x "$APP/node_modules/electron/dist/electron" ]; then
  node node_modules/electron/install.js
fi
[ -x "$APP/node_modules/electron/dist/electron" ] || { echo "Could not set up the Electron runtime. Check your internet connection and run this again."; exit 1; }

DESK="[Desktop Entry]
Type=Application
Name=Sip Water Buddy
Comment=Friendly reminders from a hero and a pet
Exec=\"$APP/start.sh\"
Icon=$APP/assets/icons/icon.png
Terminal=false
Categories=Utility;"
mkdir -p "$HOME/.local/share/applications" "$HOME/.config/autostart"
printf '%s\n' "$DESK" > "$HOME/.local/share/applications/sip-water-buddy.desktop"
# Start at sign-in (you can switch this off in Sip's Settings > General)
[ -f "$HOME/.config/autostart/sip-water-buddy.desktop" ] || printf '%s\nX-GNOME-Autostart-enabled=true\n' "$DESK" > "$HOME/.config/autostart/sip-water-buddy.desktop"

"$APP/start.sh"
echo
echo "Installed to $APP"
echo "Look for the water-drop icon in the top bar: double-click it, or choose 'Open Settings...'."
echo "You can delete the folder you downloaded."
echo "To remove Sip completely later: $APP/uninstall.sh"
