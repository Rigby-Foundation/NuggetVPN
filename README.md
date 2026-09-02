# NuggetVPN

NuggetVPN is a modern, lightweight, and fast VPN client built with [Wails v3](https://v3.wails.io/) and [React 19](https://react.dev/). [sing-box](https://sing-box.sagernet.org/) is compiled **into** the application as a Go library — there is no bundled `sing-box` executable and nothing is shelled out to.

## Architecture

The app ships as a single binary with two modes:

```
NuggetVPN                  the GUI (runs as your user)
NuggetVPN --core-service   the privileged core (started by the GUI)
```

Creating a TUN interface requires root, but a browser engine should never run as root. So the GUI re-executes *itself* behind the platform's authorization prompt (`osascript` on macOS, `pkexec` on Linux, UAC on Windows) and drives that process over a unix socket owned by your user account. Both sides are the same executable, so the UI and the tunnel can never drift to different sing-box versions.

The core service holds a live `*box.Box`: starting a profile is a function call, not a config file plus a process spawn. Logs, connection state and byte counters come back over the same connection and stream straight into the UI.

```
┌────────────────┐   unix socket    ┌──────────────────────────┐
│  GUI (user)    │ ───────────────► │  --core-service (root)   │
│  React + Wails │   JSON lines     │  sing-box as a library   │
│                │ ◄─────────────── │  TUN + routing + DNS     │
└────────────────┘ logs/state/stats └──────────────────────────┘
```

Quitting the GUI shuts the core down, and the core independently watches the GUI's pid — so a crash cannot leave a root process holding your routing table.

### The control socket is authenticated

Anything that can talk to that socket can hand an arbitrary sing-box config to a
root process, so file permissions are not enough on their own — `chmod` and
`chown` do nothing for `AF_UNIX` on Windows. Every connection must open with a
handshake carrying a 256-bit per-session token. The GUI generates it, writes it
to a `0600` file, and the elevated process reads and deletes that file on
startup; a connection that cannot produce it is closed without being told
anything, including whether a tunnel exists. The token travels through a file
rather than a command-line argument because argv is world-readable on Linux.

### There is no Clash API listener

The traffic counters come from sing-box's own accounting, read in-process and
pushed to the UI over the control socket. sing-box builds that accounting
whenever a `clash_api` block is present, and leaving `external_controller`
unset means it never opens a socket for it.

That is deliberate. Setting `external_controller` would publish an
unauthenticated control plane for the *root* core on loopback, and sing-box
serves it with permissive CORS — so every local program, and every web page you
visit, could read your live connection list and drive the tunnel. Two integers
are not worth that.

## Features

- **Protocol support** — VLESS (including **Reality** + XTLS Vision), VMess, Trojan, Shadowsocks, Hysteria, Hysteria2, TUIC, WireGuard, SOCKS, HTTP and SSH, over TCP, WebSocket, gRPC, HTTP/2 and HTTPUpgrade.
- **Profile management** — subscription import and refresh, manual `vless://`, `ss://`, `vmess://` … links, persistent storage.
- **Custom sing-box configs** — paste a full sing-box JSON config and it runs verbatim; paste just an `outbounds` document and the app layers its own TUN, DNS and routing on top.
- **Split tunnelling** — route selected applications and/or domains through the proxy while everything else goes direct.
- **Proxy chaining** — stack multiple profiles; each hop dials through the previous one.
- **Live traffic counters** — real byte counts from the core, not estimates.
- **Real-time logging** — sing-box logs streamed into the app and mirrored to `session.log`.
- **System tray** — closing the window hides it and leaves the tunnel up; the tray menu reopens it, disconnects, or quits.

### About Reality

sing-box implements Reality on top of uTLS, so a Reality outbound is only valid when a `utls` block is present. NuggetVPN always emits one (defaulting the fingerprint to `chrome`) and drops `flow=xtls-rprx-vision` when the transport is not raw TCP, because Vision does not exist on WebSocket or gRPC. Both rules are covered by tests that feed generated configs through sing-box's own option parser.

## Prerequisites

- **Go** 1.25.5 or newer (the version `go.mod` requires; CI pins the same).
- **Bun** (or Node.js) for the frontend.
- **Wails CLI** v3.0.0-alpha2.117:
  ```bash
  go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.117
  ```
- **Build tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `libgtk-4-dev`, `libwebkitgtk-6.0-dev`, plus `pkexec` (polkit) at runtime.
  - **Windows**: WebView2.

## Development

```bash
git clone https://github.com/Rigby-Foundation/NuggetVPN.git
cd NuggetVPN
make dev
```

> On first connect the app asks for administrator privileges to create the TUN interface. The prompt appears once per app session, not once per connection.

## Building and packaging

```bash
make build              # compile into bin/
make package            # package for the host platform
make test               # Go test suite
```

Distributable artifacts:

| Command | Produces |
| --- | --- |
| `make dmg` | `bin/NuggetVPN.dmg` |
| `make dmg-universal` | universal (arm64 + amd64) `.dmg` |
| `make linux-packages` | `.deb`, `.rpm` and `.AppImage` in `bin/` |
| `make package` (Windows) | `NuggetVPN.exe` plus `NuggetVPN-amd64-installer.exe` (NSIS) |

Wails v3 ships the `.app`, `.deb`, `.rpm` and AppImage packagers; the DMG is
ours, in `build/darwin/make-dmg.sh`. It uses only `hdiutil` and `osascript`, so
there is nothing extra to install.

### Build tags are mandatory

sing-box gates its features behind build tags. Miss one and the feature disappears **silently at runtime**:

| Tag | Without it |
| --- | --- |
| `with_utls` | VLESS Reality does not work |
| `with_quic` | no Hysteria, Hysteria2 or TUIC |
| `with_gvisor` | the TUN interface cannot start |
| `with_wireguard` | no WireGuard endpoints |
| `with_clash_api` | no traffic counters (sing-box builds its byte accounting with this tag; the app reads it in-process and never opens the HTTP listener) |

`buildtags.go` turns a missing tag into a compile error, and the tag list lives in
`Taskfile.yml` as `SING_BOX_TAGS`, applied automatically by every build task —
including a bare `wails3 build`. To pass them by hand:

```bash
go build -tags "$(make -s tags)" .
```

## Troubleshooting

### "App is damaged and can't be opened" (macOS)

The app is not signed with an Apple Developer Certificate, so Gatekeeper may block it:

```bash
xattr -cr /Applications/NuggetVPN.app
```

### Where things live

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Profiles & settings | `~/Library/Application Support/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/org.rigbyfoundation.nuggetvpn` | `%APPDATA%\org.rigbyfoundation.nuggetvpn` |
| Logs | `~/Library/Logs/org.rigbyfoundation.nuggetvpn` | `$XDG_DATA_HOME/.../logs` | `%LOCALAPPDATA%\...\logs` |
| Generated core config | `~/Library/Caches/org.rigbyfoundation.nuggetvpn/config.json` | `$XDG_CACHE_HOME/...` | `%LOCALAPPDATA%\...\runtime` |

These are the same paths the previous build used, so profiles and settings survive the upgrade.

## Project structure

- **`main.go`** — entry point, mode dispatch (GUI vs core service), window and system tray.
- **`app.go`** — everything the frontend can call.
- **`Taskfile.yml`, `build/`** — the Wails v3 build and packaging pipeline, including `build/darwin/make-dmg.sh`.
- **`internal/core/`** — embedded sing-box lifecycle, the privileged service and its client.
- **`internal/sbconfig/`** — turns a profile plus settings into a sing-box config.
- **`internal/link/`** — share links, sing-box JSON and legacy Clash YAML → sing-box outbounds.
- **`internal/remote/`** — subscriptions and profile sync.
- **`internal/probe/`** — latency and connectivity probes.
- **`internal/storage/`**, **`internal/models/`** — persistence and shared types.
- **`frontend/`** — React application. `src/lib/backend.ts` bridges it to the Go bindings; `src/hooks/` holds the state that mirrors the backend (connection, traffic, logs, profiles).

## Known limitations

- **Wails v3 is still in alpha.** The app is pinned to `v3.0.0-alpha2.117`; upgrading the CLI without upgrading the module (or the reverse) will produce mismatch warnings or build errors. Bump both together.
- **Windows ships an NSIS installer only.** MSIX packaging has been removed; `wails3 tool msix` still expects a v2-style `wails.json` that this project does not have.
- **`rigby://` profiles are not supported.** That protocol only exists in the clash-rs fork; sing-box has no implementation. Such profiles are still listed and report a clear error on connect.
- **Nothing is code-signed.** macOS builds are ad-hoc signed and Linux packages are unsigned, so users still need the `xattr` step above. `wails3 tool sign` handles Developer ID signing, notarization and PGP-signed Linux packages once you have credentials.

## License

This project is licensed under the [GPL-3.0 License](LICENSE).
