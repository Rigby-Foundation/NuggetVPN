#!/bin/sh
# NuggetVPN installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Rigby-Foundation/NuggetVPN/main/scripts/install.sh | sh
#
# Downloads the latest release from GitHub, checks it against the SHA-256
# GitHub publishes for it, and installs it:
#   macOS  the app into /Applications (or ~/Applications), then opens it
#   Linux  the .deb through apt or the .rpm through dnf/zypper when there is
#          one; otherwise the AppImage into ~/.local/bin, with a menu entry
# Running it again updates an existing install.

set -eu

REPO="Rigby-Foundation/NuggetVPN"
API="https://api.github.com/repos/$REPO/releases/latest"

say() { printf '  %s\n' "$*"; }
fail() { printf '  error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have curl || fail "curl is required"

WORK=$(mktemp -d)
cleanup() {
    if [ -n "${MOUNT:-}" ]; then hdiutil detach -quiet -force "$MOUNT" >/dev/null 2>&1 || true; fi
    rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

say "Looking up the latest release..."
curl -fsSL -H "Accept: application/vnd.github+json" -H "User-Agent: NuggetVPN-install" "$API" -o "$WORK/release.json" \
    || fail "could not reach GitHub"
TAG=$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' "$WORK/release.json" | head -n 1)

# asset SUFFIX -> prints "<url> <sha256 or empty>" for the asset whose name ends
# in SUFFIX. The JSON is split one field per line first (GitHub sends it
# either compact or pretty-printed); each asset gives its "digest" before its
# "browser_download_url".
asset() {
    tr ',{}' '\n\n\n' < "$WORK/release.json" | awk -v suffix="$1" '
        /"url": *"https:\/\/api\.github\.com\/repos\/.*\/releases\/assets\// { digest = "" }
        /"digest": *"sha256:/ { match($0, /sha256:[0-9a-f]+/); digest = substr($0, RSTART + 7, RLENGTH - 7) }
        /"browser_download_url":/ {
            match($0, /https:[^"]+/); url = substr($0, RSTART, RLENGTH)
            if (substr(url, length(url) - length(suffix) + 1) == suffix) { print url, digest; exit }
        }
    '
}

# download SUFFIX -> fetches that asset into $WORK, verifies it, prints its path
download() {
    found=$(asset "$1")
    [ -n "$found" ] || fail "release $TAG has no *$1 download"
    url=${found%% *}
    digest=${found#* }
    [ "$digest" = "$url" ] && digest=""
    file="$WORK/${url##*/}"
    say "Downloading ${url##*/}..." >&2
    curl -fL --progress-bar -H "User-Agent: NuggetVPN-install" "$url" -o "$file" || fail "download failed"
    if [ -n "$digest" ]; then
        if have sha256sum; then actual=$(sha256sum "$file" | cut -d' ' -f1)
        else actual=$(shasum -a 256 "$file" | cut -d' ' -f1); fi
        [ "$actual" = "$digest" ] || fail "the download does not match its published checksum; not installing"
        say "Checksum verified." >&2
    fi
    printf '%s\n' "$file"
}

# Run as root when needed: directly if already root, otherwise through sudo.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then "$@"
    elif have sudo; then sudo "$@"
    else fail "this step needs root, and sudo is not available"; fi
}

install_macos() {
    image=$(download "-macos-universal.dmg")
    MOUNT="$WORK/mount"
    mkdir -p "$MOUNT"
    hdiutil attach -nobrowse -noautoopen -readonly -quiet -mountpoint "$MOUNT" "$image" || fail "could not open the disk image"
    app=$(find "$MOUNT" -maxdepth 1 -name '*.app' | head -n 1)
    [ -n "$app" ] || fail "the disk image has no app in it"
    name=${app##*/}

    destination=/Applications
    if [ ! -w "$destination" ] && ! have sudo; then
        destination="$HOME/Applications"
        mkdir -p "$destination"
    fi
    say "Installing to $destination/$name..."
    # Quit a running copy first, so it is not replaced under itself.
    osascript -e "quit app \"${name%.app}\"" >/dev/null 2>&1 || true
    if [ -w "$destination" ]; then
        rm -rf "$destination/$name"
        ditto "$app" "$destination/$name"
    else
        as_root rm -rf "$destination/$name"
        as_root ditto "$app" "$destination/$name"
    fi
    say "NuggetVPN $TAG is installed."
    open "$destination/$name"
}

install_linux() {
    case "$(uname -m)" in
        x86_64|amd64) ;;
        *) fail "only x86_64 Linux builds are published; this is $(uname -m)" ;;
    esac

    if have apt-get && have dpkg; then
        package=$(download "-linux-amd64.deb")
        say "Installing with apt..."
        as_root apt-get install -y "$package"
    elif have dnf; then
        package=$(download "-linux-amd64.rpm")
        say "Installing with dnf..."
        as_root dnf install -y "$package"
    elif have zypper; then
        package=$(download "-linux-amd64.rpm")
        say "Installing with zypper..."
        as_root zypper --non-interactive install --allow-unsigned-rpm "$package"
    else
        image=$(download "-linux-amd64.AppImage")
        bin="$HOME/.local/bin"
        mkdir -p "$bin" "$HOME/.local/share/applications"
        install -m 755 "$image" "$bin/NuggetVPN.AppImage"
        cat > "$HOME/.local/share/applications/nuggetvpn.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=NuggetVPN
Exec=$bin/NuggetVPN.AppImage
Terminal=false
Categories=Network;
EOF
        say "Installed to $bin/NuggetVPN.AppImage (needs libfuse2 to run)."
        case ":$PATH:" in *":$bin:"*) ;; *) say "Add $bin to your PATH to run it from a terminal." ;; esac
    fi
    say "NuggetVPN $TAG is installed."
}

case "$(uname -s)" in
    Darwin) install_macos ;;
    Linux) install_linux ;;
    *) fail "unsupported system: $(uname -s); on Windows use install.ps1" ;;
esac
