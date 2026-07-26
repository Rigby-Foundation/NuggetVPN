#!/usr/bin/env bash
#
# Builds a distributable .dmg from an already-packaged .app bundle.
#
# Wails v3 ships packaging for .app, .deb, .rpm and AppImage but not for DMG,
# so this is ours. It uses only hdiutil and osascript, both part of macOS, so
# there is nothing to install.
#
# Usage: make-dmg.sh <path-to-.app> <output.dmg> [volume name]
set -euo pipefail

APP_PATH="${1:?usage: make-dmg.sh <app> <output.dmg> [volume name]}"
DMG_PATH="${2:?usage: make-dmg.sh <app> <output.dmg> [volume name]}"
VOLUME_NAME="${3:-$(basename "${APP_PATH%.app}")}"

if [ ! -d "$APP_PATH" ]; then
  echo "error: $APP_PATH does not exist" >&2
  exit 1
fi

APP_NAME="$(basename "$APP_PATH")"
STAGING="$(mktemp -d)"
TEMP_DMG="$(mktemp -u).dmg"
trap 'rm -rf "$STAGING" "$TEMP_DMG"' EXIT

echo "==> Staging $APP_NAME"
# ditto preserves the bundle's symlinks, resource forks and permissions.
ditto "$APP_PATH" "$STAGING/$APP_NAME"
ln -s /Applications "$STAGING/Applications"

# Size the image from the payload plus room for the filesystem overhead.
SIZE_KB=$(du -sk "$STAGING" | cut -f1)
SIZE_MB=$(( SIZE_KB / 1024 + 64 ))

echo "==> Creating writable image (${SIZE_MB}MB)"
hdiutil create \
  -srcfolder "$STAGING" \
  -volname "$VOLUME_NAME" \
  -fs HFS+ \
  -fsargs "-c c=64,a=16,e=16" \
  -format UDRW \
  -size "${SIZE_MB}m" \
  "$TEMP_DMG" >/dev/null

echo "==> Arranging window"
DEVICE=$(hdiutil attach -readwrite -noverify -noautoopen "$TEMP_DMG" |
  grep -E '^/dev/' | head -1 | awk '{print $1}')
MOUNT_POINT="/Volumes/$VOLUME_NAME"

# Give the volume a moment to settle before scripting Finder against it.
for _ in $(seq 1 20); do
  [ -d "$MOUNT_POINT" ] && break
  sleep 0.2
done

# Finder is unavailable on headless CI runners; the layout is cosmetic, so a
# failure here must not fail the build.
osascript <<APPLESCRIPT >/dev/null 2>&1 || echo "    (skipped Finder layout)"
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {200, 120, 800, 520}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 96
    set position of item "$APP_NAME" of container window to {150, 190}
    set position of item "Applications" of container window to {450, 190}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
APPLESCRIPT

chmod -Rf go-w "$MOUNT_POINT" 2>/dev/null || true
sync

echo "==> Detaching"
hdiutil detach "$DEVICE" >/dev/null || hdiutil detach "$DEVICE" -force >/dev/null

echo "==> Compressing"
rm -f "$DMG_PATH"
mkdir -p "$(dirname "$DMG_PATH")"
hdiutil convert "$TEMP_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH" >/dev/null

echo "==> Built $DMG_PATH"
