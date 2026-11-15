# Contributing to Kage

Thank you for your interest in contributing to Kage! We welcome contributions from the community to help make this the best VPN client for privacy enthusiasts.

## Getting Started

### Prerequisites

Ensure you have the development environment set up as described in the [README.md](README.md). You will need:

- Go 1.27+
- Bun (or Node.js)
- The Wails v3 CLI: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0`
- A working C toolchain for your OS

There is no sidecar to download. Xray is a Go module dependency and is compiled into the binary.

### Setting Up the Environment

1. **Fork and Clone**: Fork the repository to your GitHub account and clone it locally.
2. **Run it**: `make dev`

## Development Workflow

1. **Create a Branch**:
   ```bash
   git checkout -b feature/my-awesome-feature
   ```
2. **Make Changes**:
   - Frontend code is in `frontend/src/`. We use React 19 + TailwindCSS.
   - Backend code is in Go: `app.go` for anything the UI calls, `internal/` for the rest.
   - Calls from the frontend go through `frontend/src/lib/backend.ts`. Adding a
     backend call means adding an exported method on `App` and one entry to the
     command table in that file.
3. **Test**:
   ```bash
   make test     # Go test suite, including the native Xray config tests
   make vet
   ```
   Then run `make dev` and confirm the VPN connects and disconnects cleanly.
4. **Format**:
   - Go: `gofmt -w .`
   - Frontend: `cd frontend && bun run build` (runs `tsc` too)

### Build tags

The native Xray runtime needs no feature tags. Use `make` / `wails3 task`, or
normal Go build and test commands. The pinned upstream revision needs Go 1.27.

### Adding a backend call

Export the method on `internal/app.App` and call it through Wails generated
bindings, or `Call.ByName` with the service name in `frontend/src/lib/window.ts`.
The service-name and window-action tests check the currently rebuilt frontend's
bridge. The old all-method command table was removed with the old UI.

### Touching config generation

`internal/xrayconfig` builds native Xray JSON and routing code. Its tests load
and start Xray's real router to verify matching, including logical and inverted
rules. Keep these tests and the service's local traffic tests passing when
changing protocols or routing behavior. Do not silently skip unsupported rules.

## Project Structure

- **`main.go`** — entry point; dispatches between the GUI and `--core-service`, and builds the window and system tray.
- **`app.go`** — the type bound to the frontend.
- **`Taskfile.yml`, `build/`** — the Wails v3 build and packaging pipeline.
- **`internal/core/`** — native Xray lifecycle, privileged service, IPC client, elevation.
- **`internal/xrayconfig/`** — profile + settings → native Xray config.
- **`internal/link/`** — share links, sing-box JSON and legacy Clash YAML → outbounds.
- **`internal/remote/`** — subscriptions and profile sync.
- **`internal/probe/`** — latency and connectivity probes.
- **`internal/storage/`**, **`internal/models/`** — persistence and shared types.
- **`frontend/`** — the React application.

## Pull Requests

- Please provide a clear description of what your PR does.
- If it fixes a bug, reference the issue number.
- Ensure `make test` and `make vet` pass.
- If you changed config generation, say which protocols you tested against a real server.

## License

By contributing, you agree that your contributions will be licensed under the project's [MPL-2.0 License](LICENSE).
