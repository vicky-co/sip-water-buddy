#!/usr/bin/env bash
# Completely removes Sip from this user account: stops it, deletes the program, the app-grid launcher, the start-at-sign-in entry,
# your saved data (reminders, names, added avatars/pets/sounds) and the log files. Nothing outside your home folder is touched.
# Usage: ./uninstall.sh            (asks first)
#        ./uninstall.sh --yes      (no question)
#        ./uninstall.sh --keep-data  (remove the program but keep reminders and settings)
set -u
YES=0; KEEP=0
for a in "$@"; do
  case "$a" in
    -y|--yes) YES=1 ;;
    --keep-data) KEEP=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
APP="$DATA_HOME/sip-water-buddy"
TARGETS=("$APP"
  "$DATA_HOME/applications/sip-water-buddy.desktop"
  "$CONFIG_HOME/autostart/sip-water-buddy.desktop"
  "$HOME/.cache/sip-water-buddy.log")
[ "$KEEP" -eq 1 ] || TARGETS+=("$CONFIG_HOME/sip-water-buddy")

echo "This will remove:"
for t in "${TARGETS[@]}"; do [ -e "$t" ] && echo "  $t"; done
[ "$KEEP" -eq 1 ] && echo "(Keeping your data in $CONFIG_HOME/sip-water-buddy)"
if [ "$YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " ans
  case "$ans" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 0 ;; esac
fi

# Stop any running copy (only Sip's own Electron process)
pkill -f "electron.*sip-water-buddy" 2>/dev/null || true
sleep 1

for t in "${TARGETS[@]}"; do
  case "$t" in "$HOME"/*) rm -rf -- "$t" ;; esac
done
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA_HOME/applications" 2>/dev/null || true

echo "Sip has been removed. You can also delete the folder you downloaded."
