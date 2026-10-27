#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
APP_DIR="$HOME/Applications/OmniClipboard.app"
CONTENTS="$APP_DIR/Contents"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.2manydms.omniclipboard.plist"

mkdir -p "$CONTENTS/MacOS" "$HOME/Library/LaunchAgents"
xcrun swiftc -parse-as-library -O -framework AppKit "$SCRIPT_DIR/OmniClipboard.swift" -o "$CONTENTS/MacOS/OmniClipboard"
/usr/libexec/PlistBuddy -c "Clear dict" "$CONTENTS/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.2manydms.omniclipboard" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleName string OmniClipboard" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string OmniClipboard" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundlePackageType string APPL" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$CONTENTS/Info.plist"

mkdir -p "${LAUNCH_AGENT:h}"
{
  print '<?xml version="1.0" encoding="UTF-8"?>'
  print '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  print '<plist version="1.0"><dict>'
  print '<key>Label</key><string>com.2manydms.omniclipboard</string>'
  print "<key>ProgramArguments</key><array><string>$CONTENTS/MacOS/OmniClipboard</string></array>"
  print '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>'
  print '</dict></plist>'
} > "$LAUNCH_AGENT"

launchctl bootout "gui/$(id -u)/com.2manydms.omniclipboard" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT"
print "Installed OmniClipboard. Look for the envelope in your menu bar."

# The complete Mac companion install includes the optional Wispr bridge.
# It receives no privileges until the user pairs a site and grants Accessibility.
zsh "$SCRIPT_DIR/build-dictation.sh"
zsh "$SCRIPT_DIR/.build/dictation/Omni Dictation Mac/Install.command"
