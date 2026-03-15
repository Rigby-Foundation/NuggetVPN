# NuggetVPN

NuggetVPN is a modern, lightweight, and fast VPN client built with [Tauri v2](https://tauri.app/) and [React 19](https://react.dev/). It utilizes [Clash-rs](https://github.com/Rigby-Foundation/clash-rs) as its core engine to provide robust and secure connectivity.

## Features

- **High Performance**: Built with Rust and React for minimal resource usage.
- **Protocol Support**:
  - **VLESS**: Supports Reality and TLS security flows.
  - **Shadowsocks**: Standard support for SS protocols.
  - **And others!**: We support all protocols that are implemented in clash-rs
- **Profile Management**:
  - Import profiles via URL (Subscription).
  - Manually add profiles via `vless://` or `ss://` links.
  - Persistent profile storage.
- **Real-time Logging**: View connection logs directly in the app.
- **System Integration**:
  - Automatic TUN interface creation.
  - DNS hijacking prevention.
  - Self-elevation (macOS) for necessary privileges.
- **Split Tunneling**: You can set what domains or apps to proxy.
- **Custom sing-box configs**: You can set your own sing-box config that will be converted to clash yaml.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Rust**: [Install Rust](https://www.rust-lang.org/tools/install) (latest stable).
- **Bun**: [Install Bun](https://bun.sh/) (or Node.js/npm/pnpm).
- **Build Tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: `build-essential`, `libwebkit2gtk-4.0-dev`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
  - **Windows**: C++ build tools and WebView2.

## Installation & Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/Rigby-Foundation/NuggetVPN.git
   cd NuggetVPN
   ```

2. **Install Frontend Dependencies**
   ```bash
   bun install
   ```

3. **Run in Development Mode**
   ```bash
   bun tauri dev
   ```
   *Note: On macOS/Linux, the app may request administrative privileges (sudo) to create the TUN interface.*

## Building for Production

To build the application for your OS:

```bash
bun tauri build
```

The output will be in `src-tauri/target/release/bundle/`.

## Troubleshooting

### "App is damaged and can't be opened" (macOS)
Since this app is not signed with an Apple Developer Certificate (to keep it free and open-source), macOS Gatekeeper may block it. To fix this:

1. Open Terminal.
2. Run the following command:
   ```bash
   xattr -cr /Applications/NuggetVPN.app
   ```
   *(Replace `/Applications/NuggetVPN.app` with the actual path if you installed it elsewhere)*

## Project Structure

- **`src/`**: React frontend application.
  - **`lib/`**: Some shadcn libs.
  - **`hooks/`**: shadcn/ui hooks.
  - **`components/`**: Reusable UI components.
- **`src-tauri/`**: Rust backend and Tauri configuration.
  - **`src/lib.rs`**: Main application logic, commands, and VPN management.
  - **`capabilities/`**: Tauri permission configurations.
  - **`bin/`**: External binaries (clash-rs).

## License

This project is licensed under the [GPL-3.0 License](LICENSE).
