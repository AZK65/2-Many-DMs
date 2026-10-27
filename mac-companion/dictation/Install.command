#!/bin/zsh
set -euo pipefail
PACKAGE_DIR="${0:A:h}"
DICTATION_APP="$HOME/Applications/Omni Dictation.app"
DICTATION_AGENT="$HOME/Library/LaunchAgents/com.2manydms.omnidictation.plist"

if [[ ! -d "$PACKAGE_DIR/Omni Dictation.app" ]]; then
  print "Keep Install.command beside Omni Dictation.app in the unzipped folder."
  exit 1
fi
if [[ -e "$DICTATION_APP" ]]; then
  identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DICTATION_APP/Contents/Info.plist")
  [[ "$identifier" == "com.2manydms.omnidictation" ]] || { print "A different app already uses this name. Nothing changed."; exit 1; }
fi
mkdir -p "$HOME/Applications" "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/com.2manydms.omnidictation" 2>/dev/null || true
ditto "$PACKAGE_DIR/Omni Dictation.app" "$DICTATION_APP"
cp "$PACKAGE_DIR/LaunchAgent.plist" "$DICTATION_AGENT"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $DICTATION_APP/Contents/MacOS/OmniDictation" "$DICTATION_AGENT"
launchctl bootstrap "gui/$(id -u)" "$DICTATION_AGENT"
print "Omni Dictation installed and enabled at login."
print "Use its menu-bar mic to pair Omni and open Accessibility settings."
print "Wispr Flow is separate: install it from https://wisprflow.ai/downloads and finish its setup."
