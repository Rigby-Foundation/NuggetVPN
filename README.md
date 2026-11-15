# Kage

A fast, good-looking VPN client for Windows, macOS, Linux, Android and iOS, built with
[Wails v3](https://v3.wails.io/) and [React 19](https://react.dev/).

Previously named NuggetVPN. Existing profiles, preferences, backups, plugins,
and `nuggetvpn://` import links remain compatible. The repository, bundle
identifier, data directories, and subscription User-Agent retain their existing
names for compatibility.

Every proxy core it can run is compiled **into** the app as a Go library.
There is no bundled executable, nothing is downloaded at runtime, and
nothing is shelled out to.

## Installing

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Rigby-Foundation/NuggetVPN/main/scripts/install.ps1 | iex
```

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/Rigby-Foundation/NuggetVPN/main/scripts/install.sh | sh
```

Both fetch the latest release from GitHub, check it against the SHA-256
GitHub publishes for it, install it, and start the app; running them again
updates. On Linux the `.deb` or `.rpm` is used when apt, dnf or zypper is
there, the AppImage otherwise. Or download from
[Releases](https://github.com/Rigby-Foundation/NuggetVPN/releases): on
Windows, `…-silent-installer.exe` installs with no questions asked, and the
regular installer takes `/S` for the same.

> [!WARNING]
> **iOS: you sign it yourself.** Kage is not on the App Store. Each
> release has an unsigned `…-ios-unsigned.ipa` (iOS 15 and newer) for you to
> sign with your own certificate, in a signing app or with TrollStore. The
> certificate must allow VPN apps (Network Extensions, packet tunnel): one
> from a free Apple ID doesn't, so with it the app installs but never
> connects.

## Features

### Connecting

- **Native Xray**: VLESS (including **Reality** and XTLS Vision), VMess,
  Trojan, Shadowsocks, WireGuard, SOCKS and HTTP, with supported TCP,
  WebSocket, gRPC, HTTPUpgrade and **XHTTP** transports. See [Core](#core).
- **Subscriptions**, with data usage and expiry shown when the provider
  reports them. Share links (`vless://`, `vmess://`, `ss://` and others),
  legacy JSON and Clash subscriptions can supply server descriptions.
- **Proxy chains**, where each hop dials through the one before it.
- **Fastest server**: the tunnel keeps measuring the best few servers and
  moves to whichever is fastest.
- **Kill switch** and **automatic reconnect**.
- **Server health**: servers are checked in the background, and in
  automatic mode the ones that keep failing are tried last.
- **Wi-Fi rules**: connect on networks you don't trust, disconnect on ones
  you do.
- **QR codes** for sharing a server. `nuggetvpn://` links and links copied
  to the clipboard are offered for import.

### Routing

- **A routing graph** on its own tab. You match traffic by application,
  domain, IP/CIDR, port, protocol, regex, GeoIP/GeoSite or a downloaded rule
  list. Each match goes through the tunnel, straight out, or nowhere.
- **Combined rules** (AND / OR / NOT), and a **server and DNS per rule**.
- **Rule order** you can see and change. Undo and redo are available.
- **Ready-made setups**, custom geo files, notes, and `.vflow` files for
  sharing a whole routing setup.
- **Live hit counts** on every rule.
- **A schedule** that switches routing setups by time of the week, such as
  "Work" on weekdays from 9 to 6.

### Watching

- **Connections screen**: every open connection, with the program behind it,
  the rule that caught it and the server it went through. You can close any
  of them.
- **Live traffic counters** read from the core, not estimated.
- **Statistics**: traffic by app, day by day, and each server's uptime and
  latency over the last day and week. Kept on your computer only.
- **Speed test** through the current server, from the Connection screen.
- **Logs** streamed from the core. They are off by default in release
  builds.
- **A command line**: `Kage status`, `connect Tokyo`, `disconnect` and
  more control the running app from a terminal or a script. See
  [docs/cli.md](docs/cli.md).

### Plugins

Plugins can bring themes, fonts and routing setups, and add pages of their
own. Pages run in a sandbox and use a permission-checked app API. On desktop,
plugins can also include a native backend, with or without a JS page. Native
code runs as your user and requires explicit approval. The client pins each
plugin’s checksum and disables changed files until you approve them again.
See [docs/plugins](docs/plugins/README.md), the
[JS example](examples/plugins/glance), and the
[native/hybrid guide](docs/plugins/native.md).

### Everything else

- **Themes**: over thirty presets, including Catppuccin, Dracula, Gruvbox,
  Tokyo Night, Rosé Pine, Everforest and Solarized. You can also build your
  own theme with a custom font and a background picture with blur and other
  effects.
- **Six languages**: English, Russian, Ukrainian, Chinese, Japanese and
  Persian. Persian uses a right-to-left layout.
- **Proxies list** with favourites, search, sorting and multi-select.
- **System tray**, a **global connect shortcut**, and **notifications**.
- **Launch at login**, auto-connect, and a choice of what closing the window
  does.
- **Updates** checked for and installed from inside the app.
- **Backups**: settings, profiles, routing and theme files can be exported
  and imported as one file.

## Core

Xray is the only proxy and VPN engine. Its native TUN inbound handles packets,
its DNS and router handle lookups and the routing graph, and its outbounds reach
servers directly. No sing-box, mihomo, secondary proxy engine or loopback bridge
is built or launched. There is no core selector.

The app pins upstream Xray revision `5d17b872edde` for automatic desktop TUN
routes, interface binding, process matching and the native Lua router. It needs
Go 1.27. Android and iOS pass their OS-provided tunnel descriptor directly to
Xray. Windows packages must provide the architecture's `wintun.dll` beside Kage.
Linux VPN mode currently requires systemd-resolved and `resolvectl` so Xray can
configure DNS without falling back to a leaking system resolver.

Share links and legacy subscription formats are imported as server descriptions;
only native Xray configuration is executed. Protocols or transport options Xray
cannot implement are rejected. Old `core` settings are ignored when loading and
are removed the next time settings are saved.

## Architecture

The app is a single binary with two modes:

```
Kage                  the GUI (runs as your user)
Kage --core-service   the privileged core (started by the GUI)
```

Creating a TUN interface requires root, but a browser engine should never
run as root. So the GUI re-runs *itself* behind the platform's authorization
prompt: `osascript` on macOS, `pkexec` on Linux and UAC on Windows. It then
drives that process over a socket. Both sides are the same executable, so
the UI and the tunnel can never drift apart in version.

```
┌────────────────┐     socket       ┌──────────────────────────┐
│  GUI (user)    │ ───────────────► │  --core-service (root)   │
│  React + Wails │   JSON lines     │  native Xray engine       │
│                │ ◄─────────────── │  TUN + routing + DNS     │
└────────────────┘ logs/state/stats └──────────────────────────┘
```

Starting a profile is a function call inside the service, not a config file
plus a process spawn. Logs, connection state, byte counters and the
connection list come back over the same socket. Quitting the GUI shuts the
service down, and the service also watches the GUI's process. A crash
therefore cannot leave a root process holding your routing table.

### The control socket is authenticated

Anything that can talk to that socket can hand a config to a root process.
File permissions are not enough on their own, because `chmod` and `chown` do
nothing for `AF_UNIX` on Windows. So every connection must open with a
256-bit per-session token:

1. The GUI generates the token and writes it to a `0600` file.
2. The elevated process reads that file and deletes it.
3. A connection that can't produce the token is closed without being told
   anything, including whether a tunnel exists.

The token travels through a file rather than a command-line argument because
argv is world-readable on Linux.

### No core exposes an API

Counters and live connections are tracked around Xray's in-process dispatch.
No HTTP controller is exposed. API listeners and log-file paths in incoming
configs are removed at the service boundary.

## Building

### Prerequisites

- **Go** 1.26 or newer.
- **Bun** (or Node.js) for the frontend.
- **Wails CLI** v3.0.0:
  ```bash
  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0
  ```
  Keep the CLI, Go module and `@wailsio/runtime` on the same version.
- **Platform tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `libgtk-4-dev` and `libwebkitgtk-6.0-dev`. At runtime, `pkexec`
    (polkit).
  - **Windows**: WebView2, and NSIS for the installer.

### Commands

```bash
git clone https://github.com/Rigby-Foundation/NuggetVPN.git
cd NuggetVPN
make dev                # run with hot reload
make build              # compile into bin/
make test               # Go test suite, with the right build tags
make vet
```

The first time you connect, the app asks for administrator rights to create
the TUN interface. It asks once per app session, not once per connection.

| Command | Produces |
| --- | --- |
| `make dmg` | `bin/Kage.dmg` |
| `make dmg-universal` | a universal (arm64 + amd64) `.dmg` |
| `make linux-packages` | `.deb`, `.rpm` and `.AppImage` in `bin/` |
| `make package` (Windows) | `Kage.exe` and an NSIS installer |

Wails ships the `.app`, `.deb`, `.rpm` and AppImage packagers. The DMG
script is ours, in `build/darwin/make-dmg.sh`, and it only uses `hdiutil` and
`osascript`.

### Android

The same app, on Wails' Android support: the Go code is built into a shared
library that a small Java host (`build/android`) loads into a WebView. You
need the Android NDK (`ANDROID_NDK_HOME`), and for the APK a JDK 17 and the
Android SDK (`ANDROID_HOME`).

```bash
wails3 task android:apk          # debug APK for arm64, in bin/
wails3 task android:package      # release APK for arm64 and x86_64
wails3 task android:run:device   # debug build on a connected phone
```

How it differs from the desktop:

- **The tunnel:** Android's VpnService provides it. The core service runs
  inside the app, and `internal/android` gives Xray the tunnel, keeps the
  core's own sockets out of it, and reports the network in use.
- **Core:** the same native Xray engine as desktop. VpnService sockets are
  protected directly, and connection owners come from Android's bridge.
- **The "System" theme:** Android 12 and later use the wallpaper's Material
  You colours. Desktop builds also follow wallpaper colours, as described below.
- **Plugins:** they bring themes, fonts and routing setups, but their pages
  don't run. Android's WebView gives its native bridge to every frame, so a
  plugin page couldn't be kept apart from the app.
- **Not on Android:** Wi-Fi rules, launching at login, the global shortcut,
  the tray, the command line and in-app updates.

Release APKs are signed with the key from the `ANDROID_KEYSTORE_*` secrets;
see `.github/workflows/release.yml`.

### Wallpaper colours

The System theme extracts colours from the primary display's wallpaper on
Windows and macOS. Linux supports GNOME, KDE Plasma, Xfce, Cinnamon and MATE.
Colours refresh on focus and every 30 seconds while System is selected,
and light/dark mode follows the OS. GNOME timed XML wallpapers use the
first still image. If a wallpaper cannot be read, System uses the default
light/dark colours. A manually chosen accent still takes priority.

### Build tags

Native Xray requires no sing-box feature tags. `make build`, `make test` and
`wails3 task build` use the normal Go build. `EXTRA_TAGS` remains available for
optional application-specific tags.

## Where things live

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Profiles and settings | `~/Library/Application Support/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/org.rigbyfoundation.nuggetvpn` | `%APPDATA%\org.rigbyfoundation.nuggetvpn` |
| Logs | `~/Library/Logs/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/.../logs` | `%LOCALAPPDATA%\...\logs` |
| Generated core config | `~/Library/Caches/org.rigbyfoundation.nuggetvpn/` | `$XDG_CACHE_HOME/...` | `%LOCALAPPDATA%\...\runtime` |

## Project structure

- **`main.go`**: the entry point. It chooses between the GUI and the core
  service, and sets up the window and system tray.
- **`internal/app/`**: everything the frontend can call, split by concern.
  It is a separate package on purpose. Wails names a bound service after its
  package path, and `package main` reports that path differently in a binary
  than in a test.
- **`internal/core/`**: the privileged service, its client, and the
  native Xray lifecycle.
- **`internal/xrayconfig/`**: profiles and settings to native Xray JSON and
  routing code, including logical/inverted graph rules and proxy chains.
- **`internal/xrayruntime/`**: the engine, counters and live connection tracking.
- **`internal/link/`**: parses share links, sing-box JSON and Clash YAML.
- **`internal/remote/`**: subscriptions and the optional profile sync server.
- **`internal/probe/`**: latency and connectivity checks.
- **`internal/stats/`**, **`internal/speedtest/`**: statistics kept over
  time, and the speed test.
- **`internal/cli/`**: the command line, and the socket the app answers it
  on.
- **`internal/geodat/`**, **`internal/vflow/`**: geo files and the `.vflow`
  routing format.
- **`internal/autostart/`**: launch at login.
- **`internal/plugins/`**: reading, installing and serving plugins, the
  sandbox policy for their pages, checksum approval, native process supervision,
  and the SDK (`sdk/nugget.js`). The window
  side is `frontend/src/lib/plugin-host.ts`.
- **`cmd/nuggetplugin/`**: builds a `.nuggetplugin` from a folder.
- **`internal/storage/`**, **`internal/models/`**: persistence and shared
  types.
- **`frontend/`**: the React app. `src/lib/backend.ts` bridges it to Go, and
  `src/locales/` holds the translations.
- **`Taskfile.yml`**, **`build/`**: the Wails build and packaging pipeline.

## Documentation

[`docs/`](docs/README.md) has guides for writing plugins and using the
command line.

## Troubleshooting

### "App is damaged and can't be opened" (macOS)

The app is not signed with an Apple Developer certificate, so Gatekeeper may
block it:

```bash
xattr -cr /Applications/Kage.app
```

## Known limitations

- **Nothing is code-signed.** macOS builds are ad-hoc signed and Linux
  packages are unsigned.
- **Windows ships an NSIS installer only**, not MSIX.
- **`rigby://` profiles don't connect.** That protocol only exists in the
  clash-rs fork. Such profiles are still listed, and they show a clear error
  when you try to connect.

## License

[MPL-2.0](LICENSE).
