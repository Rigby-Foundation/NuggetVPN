# Contributing to NuggetVPN

Thank you for your interest in contributing to NuggetVPN! We welcome contributions from the community to help make this the best VPN client for privacy enthusiasts.

## Getting Started

### Prerequisites

Ensure you have the development environment set up as described in the [README.md](README.md). You will need:

- Go 1.24+
- Bun (or Node.js)
- The Wails v3 CLI: `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha2.117`
- A working C toolchain for your OS

There is no sidecar to download. sing-box is a Go module dependency and is compiled into the binary.

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
   make test     # Go test suite, including the sing-box config tests
   make vet
   ```
   Then run `make dev` and confirm the VPN connects and disconnects cleanly.
4. **Format**:
   - Go: `gofmt -w .`
   - Frontend: `cd frontend && bun run build` (runs `tsc` too)

### Build tags

sing-box gates features behind build tags, and a missing tag fails silently at
runtime rather than loudly at build time. `buildtags.go` converts that into a
compile error and `Taskfile.yml` holds the canonical list in `SING_BOX_TAGS`,
so prefer `make` / `wails3 task` over bare `go build`. If you add a sing-box
feature that needs a new tag, add it to `SING_BOX_TAGS` in `Taskfile.yml`, to
`buildtags.go` if it is load-bearing, and to both workflow files under
`.github/workflows/`.

### Adding a backend call

The frontend reaches Go through `frontend/src/lib/backend.ts`, which calls
methods by name rather than through the generated bindings, so the frontend
stays buildable on its own. Add the exported method on `App`, then add one row
to the command table in that file. `bridge_test.go` fails if the two drift:
unknown method, wrong argument count, or an exported `App` method with no
command mapped to it.

### Touching config generation

`internal/sbconfig` is the highest-risk area: a wrong field name produces a
config that sing-box rejects, or worse, silently accepts with the security
property removed. Tests in `internal/sbconfig/build_test.go` feed generated
configs through sing-box's real option parser and, for Reality, actually
construct the outbound. Add a case there for any protocol or option you touch.

## Project Structure

- **`main.go`** — entry point; dispatches between the GUI and `--core-service`, and builds the window and system tray.
- **`app.go`** — the type bound to the frontend.
- **`Taskfile.yml`, `build/`** — the Wails v3 build and packaging pipeline.
- **`internal/core/`** — embedded sing-box lifecycle, privileged service, IPC client, elevation.
- **`internal/sbconfig/`** — profile + settings → sing-box config.
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

By contributing, you agree that your contributions will be licensed under the project's [GPL-3.0 License](LICENSE).
