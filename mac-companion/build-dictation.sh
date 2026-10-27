#!/bin/zsh
set -euo pipefail
DICTATION_SOURCE="${0:A:h}"
DICTATION_ROOT="${DICTATION_SOURCE:h}"
DICTATION_BUILD="$DICTATION_SOURCE/.build/dictation"
DICTATION_PACKAGE="$DICTATION_BUILD/Omni Dictation Mac"
DICTATION_CONTENTS="$DICTATION_PACKAGE/Omni Dictation.app/Contents"
mkdir -p "$DICTATION_CONTENTS/MacOS" "$DICTATION_ROOT/public/downloads"
for arch in arm64 x86_64; do
  xcrun swiftc -parse-as-library -O -target "$arch-apple-macosx13.0" -framework AppKit -framework ApplicationServices -framework Network -framework Security \
    "$DICTATION_SOURCE/OmniDictation.swift" -o "$DICTATION_BUILD/OmniDictation-$arch"
done
lipo -create "$DICTATION_BUILD/OmniDictation-arm64" "$DICTATION_BUILD/OmniDictation-x86_64" -output "$DICTATION_CONTENTS/MacOS/OmniDictation"
cp "$DICTATION_SOURCE/dictation/Info.plist" "$DICTATION_CONTENTS/Info.plist"
cp "$DICTATION_SOURCE/dictation/Install.command" "$DICTATION_SOURCE/dictation/LaunchAgent.plist" "$DICTATION_SOURCE/dictation/README.txt" "$DICTATION_PACKAGE/"
chmod +x "$DICTATION_PACKAGE/Install.command"
# Local developer build. Set an Apple Developer ID for a distributable release;
# notarization must be completed separately before public distribution.
codesign --force --options runtime --sign "${OMNI_MAC_SIGN_IDENTITY:--}" "$DICTATION_PACKAGE/Omni Dictation.app"
"$DICTATION_CONTENTS/MacOS/OmniDictation" --self-test
ditto -c -k --keepParent "$DICTATION_PACKAGE" "$DICTATION_ROOT/public/downloads/omni-dictation-macos.zip"
print "Built public/downloads/omni-dictation-macos.zip (Apple Silicon + Intel)."
