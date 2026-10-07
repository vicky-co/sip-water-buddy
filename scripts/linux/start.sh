#!/usr/bin/env bash
# Starts Sip detached from the terminal, so closing the terminal doesn't stop it.
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
LOG="$HOME/.cache/sip-water-buddy.log"
mkdir -p "$HOME/.cache"
BIN="$DIR/node_modules/electron/dist/electron"
[ -x "$BIN" ] || BIN="$DIR/node_modules/.bin/electron"
setsid -f "$BIN" "$DIR" --no-sandbox --ozone-platform=x11 >>"$LOG" 2>&1 </dev/null
echo "Sip is running in the background. You can close this terminal."
echo "Stop it from the water-drop icon in the top bar → Quit.  Logs: $LOG"
