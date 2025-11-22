# NuggetVPN

NuggetVPN is a modern, lightweight, and fast VPN client built with [Tauri v2](https://tauri.app/) and [Svelte 5](https://svelte.dev/). It utilizes [sing-box](https://sing-box.sagernet.org/) as its core engine to provide robust and secure connectivity.

## Features

- **High Performance**: Built with Rust and Svelte for minimal resource usage.
- **Protocol Support**:
  - **VLESS**: Supports Reality and TLS security flows.
  - **Shadowsocks**: Standard support for SS protocols.
- **Profile Management**:
  - Import profiles via URL (Subscription).
  - Manually add profiles via `vless://` or `ss://` links.
  - Persistent profile storage.
- **Real-time Logging**: View connection logs directly in the app.
- **System Integration**:
  - Automatic TUN interface creation.
  - DNS hijacking prevention.
  - Self-elevation (macOS) for necessary privileges.

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

3. **Setup Sidecar (Important)**
   NuggetVPN requires the `sing-box` binary to function. You must place the platform-specific binary in the `src-tauri/bin/` directory.
   
   - Download `sing-box` from [GitHub Releases](https://github.com/SagerNet/sing-box/releases).
   - Rename the binary to `sing-box-<target-triple>` (e.g., `sing-box-aarch64-apple-darwin` for Apple Silicon).
   - Place it in `src-tauri/bin/`.
   - Ensure it has execution permissions (`chmod +x`).

   *Note: The `tauri.conf.json` expects the binary name to be just `sing-box` in the configuration, but Tauri's sidecar mechanism requires the target triple suffix on the actual file.*

4. **Run in Development Mode**
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

## Project Structure

- **`src/`**: SvelteKit frontend application.
  - **`routes/`**: App pages and layout.
  - **`components/`**: Reusable UI components.
- **`src-tauri/`**: Rust backend and Tauri configuration.
  - **`src/lib.rs`**: Main application logic, commands, and VPN management.
  - **`capabilities/`**: Tauri permission configurations.
  - **`bin/`**: External binaries (sing-box).

## License

This project is licensed under the [GPL-3.0 License](LICENSE).
