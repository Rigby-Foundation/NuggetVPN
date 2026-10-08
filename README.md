# NuggetVPN

A fast, good-looking VPN client for Windows, macOS, Linux, Android and iOS, built with
[Wails v3](https://v3.wails.io/) and [React 19](https://react.dev/).

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
> **iOS: you sign it yourself.** NuggetVPN is not on the App Store. Each
> release has an unsigned `…-ios-unsigned.ipa` (iOS 15 and newer) for you to
> sign with your own certificate, in a signing app or with TrollStore. The
> certificate must allow VPN apps (Network Extensions, packet tunnel): one
> from a free Apple ID doesn't, so with it the app installs but never
> connects.

## Features

### Connecting

- **Every common protocol**: VLESS (including **Reality** with XTLS Vision),
  VMess, Trojan, Shadowsocks, Hysteria, Hysteria2, TUIC, WireGuard, SOCKS,
  HTTP and SSH, over TCP, WebSocket, gRPC, HTTP/2, HTTPUpgrade and **XHTTP**.
- **Four cores to choose from** (see [Cores](#cores)).
- **Subscriptions**, with data usage and expiry shown when the provider
  reports them. Share links (`vless://`, `vmess://`, `ss://` and others),
  full sing-box configs, and Clash configs are all accepted.
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
- **A command line**: `NuggetVPN status`, `connect Tokyo`, `disconnect` and
  more control the running app from a terminal or a script. See
  [docs/cli.md](docs/cli.md).

### Plugins

Plugins can bring themes, fonts and routing setups, and add pages of their
own. A plugin’s code runs in a sandbox, sealed off from the app and your
files, and can only do what you allow when you install it. See
[docs/plugins](docs/plugins/README.md) to write one, and
[`examples/plugins/glance`](examples/plugins/glance) for an example.

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

## Cores

The core is the engine that carries the traffic. You choose it under
**Settings → Core**.

| Core | What it is | Differences |
| --- | --- | --- |
| **Built-in** (default) | [TodayCore](https://github.com/TumGovic/TodayCore): sing-box 1.15 with Xray's XHTTP transport, REALITY with the `X25519MLKEM768` key share, and VLESS post-quantum encryption | None. Everything in the app is built for it. |
| **Official sing-box** | SagerNet's sing-box 1.15.0-alpha.9, unmodified apart from its module path | No XHTTP servers. |
| **mihomo** | Clash Meta 1.19. It runs complete Clash configs as they are. | Rules on a detected protocol and sing-box-format rule lists are skipped. It uses its own geo data. TLS fragmentation doesn't apply. |
| **Xray** | Xray-core 26.3. It handles the servers, while the built-in core keeps the tunnel, DNS and routing. | No Hysteria, TUIC or SSH servers. No Shadowsocks plugins. |

All four are linked into the same binary and run in the same privileged
process, so switching between them is instant.

- The fork keeps sing-box's module path through a `replace` directive.
- Official sing-box is vendored in `third_party/` under a module path of its
  own, so both can coexist. [`third_party/README.md`](third_party/README.md)
  explains what that took.
- Xray reaches the servers through a password-protected loopback entry point
  on the built-in core, which sends that traffic straight out. That keeps it
  from routing its own connections back into itself.

## Architecture

The app is a single binary with two modes:

```
NuggetVPN                  the GUI (runs as your user)
NuggetVPN --core-service   the privileged core (started by the GUI)
```

Creating a TUN interface requires root, but a browser engine should never
run as root. So the GUI re-runs *itself* behind the platform's authorization
prompt: `osascript` on macOS, `pkexec` on Linux and UAC on Windows. It then
drives that process over a socket. Both sides are the same executable, so
the UI and the tunnel can never drift apart in version.

```
┌────────────────┐     socket       ┌──────────────────────────┐
│  GUI (user)    │ ───────────────► │  --core-service (root)   │
│  React + Wails │   JSON lines     │  the cores, as libraries │
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

Every counter and connection list is read in-process. None of the cores gets
an HTTP controller. Opening one would give every local program, and through
permissive CORS every web page you visit, a view of your live connections and
a way to drive a root process. For the same reason, any API a Clash config
asks for is dropped before mihomo sees it.

## Building

### Prerequisites

- **Go** 1.26 or newer.
- **Bun** (or Node.js) for the frontend.
- **Wails CLI** v3.0.0-beta.28:
  ```bash
  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.28
  ```
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
| `make dmg` | `bin/NuggetVPN.dmg` |
| `make dmg-universal` | a universal (arm64 + amd64) `.dmg` |
| `make linux-packages` | `.deb`, `.rpm` and `.AppImage` in `bin/` |
| `make package` (Windows) | `NuggetVPN.exe` and an NSIS installer |

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
  inside the app, and `internal/android` gives sing-box the tunnel, keeps the
  core's own sockets out of it, and reports the network in use.
- **Cores:** the built-in core, and Xray behind it. Official sing-box and
  mihomo aren't available there yet.
- **The "System" theme:** on Android 12 and later it follows the
  wallpaper's colours (Material You).
- **Plugins:** they bring themes, fonts and routing setups, but their pages
  don't run. Android's WebView gives its native bridge to every frame, so a
  plugin page couldn't be kept apart from the app.
- **Not on Android:** Wi-Fi rules, launching at login, the global shortcut,
  the tray, the command line and in-app updates.

Release APKs are signed with the key from the `ANDROID_KEYSTORE_*` secrets;
see `.github/workflows/release.yml`.

### Build tags are required

sing-box gates features behind build tags, and a missing tag makes the
feature disappear **silently at runtime**:

| Tag | Without it |
| --- | --- |
| `with_utls` | Reality does not work |
| `with_quic` | no Hysteria, Hysteria2 or TUIC |
| `with_wireguard` | no WireGuard |
| `with_clash_api` | no traffic counters. The accounting is built with this tag and read in-process; no listener is opened. |
| `with_gvisor` | no legacy gVisor stack. The generated config doesn't use it; only a hand-written config that names it needs it. |

`buildtags.go` turns a missing tag into a compile error. The list lives in
`Taskfile.yml` as `SING_BOX_TAGS`, and every build task applies it, including
a bare `wails3 build`. To pass the tags by hand:

```bash
go build -tags "$(make -s tags)" .
```

## Where things live

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Profiles and settings | `~/Library/Application Support/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/org.rigbyfoundation.nuggetvpn` | `%APPDATA%\org.rigbyfoundation.nuggetvpn` |
| Logs | `~/Library/Logs/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/.../logs` | `%LOCALAPPDATA%\...\logs` |
| Generated core config | `~/Library/Caches/org.rigbyfoundation.nuggetvpn/` | `$XDG_CACHE_HOME/...` | `%LOCALAPPDATA%\...\runtime` |
| Core data (admin-only) | `/Library/Application Support/NuggetVPN/cores` | `/var/lib/nuggetvpn/cores` | `%ProgramData%\NuggetVPN\cores` |

## Project structure

- **`main.go`**: the entry point. It chooses between the GUI and the core
  service, and sets up the window and system tray.
- **`internal/app/`**: everything the frontend can call, split by concern.
  It is a separate package on purpose. Wails names a bound service after its
  package path, and `package main` reports that path differently in a binary
  than in a test.
- **`internal/core/`**: the privileged service, its client, and the
  in-process runtimes for each core.
- **`internal/sbconfig/`**: turns a profile plus settings into a sing-box
  config. `route.go` compiles the routing graph.
- **`internal/cores/`**: translation for the other cores. `mihomo/` builds a
  Clash config, and `xray/` builds Xray's server config.
- **`internal/link/`**: parses share links, sing-box JSON and Clash YAML.
- **`internal/remote/`**: subscriptions and the optional profile sync server.
- **`internal/probe/`**: latency and connectivity checks.
- **`internal/stats/`**, **`internal/speedtest/`**: statistics kept over
  time, and the speed test.
- **`internal/wifi/`**: reads the Wi-Fi network's name on each system.
- **`internal/cli/`**: the command line, and the socket the app answers it
  on.
- **`internal/geodat/`**, **`internal/vflow/`**: geo files and the `.vflow`
  routing format.
- **`internal/autostart/`**: launch at login.
- **`internal/plugins/`**: reading, installing and serving plugins, the
  sandbox policy for their pages, and the SDK (`sdk/nugget.js`). The window
  side is `frontend/src/lib/plugin-host.ts`.
- **`cmd/nuggetplugin/`**: builds a `.nuggetplugin` from a folder.
- **`internal/storage/`**, **`internal/models/`**: persistence and shared
  types.
- **`third_party/`**: official sing-box and its sing-tun, vendored under
  their own module paths.
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
xattr -cr /Applications/NuggetVPN.app
```

## Known limitations

- **Wails v3 is still in beta.** The app is pinned to `v3.0.0-beta.28`.
  Upgrade the CLI and the module together.
- **Nothing is code-signed.** macOS builds are ad-hoc signed and Linux
  packages are unsigned.
- **Windows ships an NSIS installer only**, not MSIX.
- **`rigby://` profiles don't connect.** That protocol only exists in the
  clash-rs fork. Such profiles are still listed, and they show a clear error
  when you try to connect.

## License

[GPL-3.0](LICENSE).
