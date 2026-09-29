#!/bin/bash
# Runs the timecard server now and at every login, via a LaunchAgent.
# Re-run it any time; it replaces the previous install.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.kristenmedo.timecard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/timecard.log"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$HERE/timecard_server.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

sleep 1
if curl -fsS http://127.0.0.1:8765/api/state >/dev/null; then
  echo "Timecard is running: http://127.0.0.1:8765"
else
  echo "The server didn't answer. Last lines of $LOG:"
  tail -n 20 "$LOG" 2>/dev/null || true
  exit 1
fi
