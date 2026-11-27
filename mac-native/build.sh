#!/bin/bash
set -euo pipefail
APP_SOURCE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$APP_SOURCE/.." && pwd)"
APP_OUTPUT="$REPO_ROOT/.local/native-mac/2ManyDMs.app"
swift build --package-path "$APP_SOURCE" -c release
mkdir -p "$APP_OUTPUT/Contents/MacOS" "$APP_OUTPUT/Contents/Resources"
cp "$APP_SOURCE/.build/release/TwoManyDMs" "$APP_OUTPUT/Contents/MacOS/TwoManyDMs"
ICON_SET="$APP_SOURCE/.build/AppIcon.iconset"
mkdir -p "$ICON_SET"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$REPO_ROOT/public/icon-512.png" --out "$ICON_SET/icon_${size}x${size}.png" >/dev/null
    retina=$((size * 2))
    sips -z "$retina" "$retina" "$REPO_ROOT/public/icon-512.png" --out "$ICON_SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICON_SET" -o "$APP_OUTPUT/Contents/Resources/AppIcon.icns"
cat > "$APP_OUTPUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>TwoManyDMs</string>
<key>CFBundleIdentifier</key><string>com.2manydms.native</string>
<key>CFBundleName</key><string>2ManyDMs</string>
<key>CFBundleDisplayName</key><string>2ManyDMs</string>
<key>CFBundleIconFile</key><string>AppIcon.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign "${TMD_MAC_SIGN_IDENTITY:--}" "$APP_OUTPUT"
PREVIEW_OUTPUT="$REPO_ROOT/.local/native-mac/2ManyDMs Preview.app"
mkdir -p "$PREVIEW_OUTPUT/Contents/MacOS" "$PREVIEW_OUTPUT/Contents/Resources"
cp "$APP_OUTPUT/Contents/MacOS/TwoManyDMs" "$PREVIEW_OUTPUT/Contents/MacOS/TwoManyDMs"
cp "$APP_OUTPUT/Contents/Resources/AppIcon.icns" "$PREVIEW_OUTPUT/Contents/Resources/AppIcon.icns"
cp "$APP_OUTPUT/Contents/Info.plist" "$PREVIEW_OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.2manydms.native.preview' "$PREVIEW_OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName 2ManyDMs Preview' "$PREVIEW_OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName 2ManyDMs Preview' "$PREVIEW_OUTPUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :TMDPreviewOnly bool true' "$PREVIEW_OUTPUT/Contents/Info.plist"
codesign --force --sign "${TMD_MAC_SIGN_IDENTITY:--}" "$PREVIEW_OUTPUT"
printf 'Built native preview: %s\n' "$APP_OUTPUT"
printf 'Open with synthetic conversations: open "%s" --args --demo\n' "$APP_OUTPUT"
