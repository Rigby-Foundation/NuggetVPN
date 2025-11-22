# Contributing to NuggetVPN

Thank you for your interest in contributing to NuggetVPN! We welcome contributions from the community to help make this the best VPN client for privacy enthusiasts.

## Getting Started

### Prerequisites
Ensure you have the development environment set up as described in the [README.md](README.md). You will need:
- Rust (latest stable)
- Bun (or Node.js)
- A proper C++ build environment for your OS.

### Setting Up the Environment

1. **Fork and Clone**: Fork the repository to your GitHub account and clone it locally.
2. **Install Dependencies**: Run `bun install` in the root directory.
3. **Sidecar Setup**:
   This project relies on `sing-box` as a sidecar. **You must manually provide this binary for development.**
   
   - Download the appropriate `sing-box` release for your architecture.
   - Rename it to follow the pattern: `sing-box-<target-triple>`.
     - Example (macOS M1/M2): `sing-box-aarch64-apple-darwin`
     - Example (Windows x64): `sing-box-x86_64-pc-windows-msvc.exe`
   - Place the file in `src-tauri/bin/`.
   - You can find your target triple by running `rustc -vV`.

## Development Workflow

1. **Create a Branch**: Create a new branch for your feature or bugfix.
   ```bash
   git checkout -b feature/my-awesome-feature
   ```
2. **Make Changes**:
   - Frontend code is in `src/`. We use Svelte 5 + TailwindCSS.
   - Backend code is in `src-tauri/src/`. We use Rust.
3. **Test**:
   - Run `bun tauri dev` to test the app.
   - Ensure the VPN connects and disconnects properly.
   - Check logs for any panics or errors.
4. **Format & Lint**:
   - Frontend: `bun run check`
   - Backend: `cargo fmt` and `cargo clippy` inside `src-tauri/`.

## Project Structure

- **`src/`**: The SvelteKit frontend.
  - `routes/`: File-based routing.
  - `lib/`: Shared utilities (if any).
- **`src-tauri/`**: The Tauri backend.
  - `src/lib.rs`: The core logic. It handles:
    - Profile persistence (`profiles.json`).
    - `sing-box` config generation (`config.json`).
    - Process management (spawning/killing the sidecar).
    - Self-elevation logic (for macOS).

## Pull Requests

- Please provide a clear description of what your PR does.
- If it fixes a bug, reference the issue number.
- Ensure your code is formatted and passes basic checks.
- If you are modifying the Rust backend, please verify that it compiles without warnings.

## License

By contributing, you agree that your contributions will be licensed under the project's [GPL-3.0 License](LICENSE).
