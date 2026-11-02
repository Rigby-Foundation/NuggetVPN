# Native and hybrid plugins (desktop)

A plugin can include a native executable. A **native plugin** has a backend
without pages; a **hybrid plugin** includes a backend and a panel and/or
background page. Both use the same `.nuggetplugin` package and install flow.
This is supported on Windows, macOS and Linux only, not Android or iOS.

## Manifest

Add an optional backend to a format-1 manifest:

```json
{
  "format": 1,
  "id": "com.example.diagnostics",
  "name": "Diagnostics",
  "version": "1.0.0",
  "panel": { "title": "Diagnostics", "file": "panel.html" },
  "permissions": ["state"],
  "backend": {
    "api": 1,
    "executables": {
      "darwin/arm64": "bin/diagnostics-macos-arm64",
      "darwin/amd64": "bin/diagnostics-macos-amd64",
      "linux/arm64": "bin/diagnostics-linux-arm64",
      "linux/amd64": "bin/diagnostics-linux-amd64",
      "windows/arm64": "bin/diagnostics-windows-arm64.exe",
      "windows/amd64": "bin/diagnostics-windows-amd64.exe"
    }
  }
}
```

Include only the targets you actually ship. Every named executable must be
inside the package; installation refuses unsupported platforms. Linux also
accepts `linux/386`. Windows entries must end in `.exe`. Backends can be
written in any language that can produce a desktop executable. There is no
shared-library ABI or Go-toolchain coupling.

Remove `panel` for a native-only plugin. JS/content-only plugins need no
backend and continue to work as before. The `network` field is only the
allowlist for pages, not a restriction on the native process.

## Trust and checksums

The client computes a SHA-256 over **every packaged path and its bytes**, in
sorted order. Length prefixes distinguish paths and contents; ZIP ordering,
timestamps and permission bits do not affect the checksum. The domain prefix
is `nuggetplugin-sha256-v1` followed by a NUL byte; each entry is its UTF-8
path length (uint64 big-endian), path bytes, content length (uint64 big-endian),
and content bytes. This is a package-content checksum, not the hash of the ZIP.

Installing approves and stores the checksum. Installed legacy JS/content
plugins without a checksum are pinned on their first read. Native backends
without an approved checksum are never automatically trusted.

Before serving plugin files, accepting API calls or launching a backend, the
client verifies the installed files. While the desktop app is running it also
checks every two seconds. A mismatch disables the plugin, stops its backend
on the next supervision pass, and requests approval in Settings → Plugins.
Turning the switch back on cannot bypass this. Restarting the client or
restoring the old files does not clear a recorded revocation.

**Review changed files → Approve and load** approves the checksum shown in the
dialog. The app installs exactly the snapshot reviewed, so files altered after
opening the dialog are not silently approved. Updates installed through the
normal install dialog also approve their displayed checksum.

A checksum detects changes relative to local approval. It is not a publisher
signature and does not establish who authored a plugin. An executable with
the user's OS access can also tamper with that user's files, including local
trust records; this mechanism is not an OS security boundary.

## Process lifetime

The GUI starts one backend for each enabled, approved plugin, as its own user.
Backends are never loaded into the GUI or privileged core service. Executables
and support files are copied from the verified snapshot into a private,
temporary directory, used as the working directory. The selected executable
is marked executable. Write persistent state under `NUGGET_PLUGIN_DATA`, not
into the package or working directory. Uninstalling deletes that state.

The environment is restricted to `NUGGET_PLUGIN_ID`, `NUGGET_PLUGIN_API=1`,
`NUGGET_PLUGIN_DATA`, and basic path, locale and temporary-directory variables.
The GUI's other environment variables are not inherited. This does not sandbox
the executable's ordinary filesystem or network access.

Disabling, uninstalling, updating, detecting changed files, or exiting the app
stops the backend. Unix process groups and Windows job objects clean up child
processes on normal host-controlled shutdown. This is lifecycle management,
not containment of hostile native code. A crashed or failed backend stays
stopped and shows an error; toggle it off and on to retry. Temporary runtime
files are removed after the process exits.

## JSON-lines protocol, API 1

Use stdin/stdout for newline-delimited UTF-8 JSON. Reserve stdout for the
protocol; stderr is discarded. Messages are limited to 1 MiB. Backend requests
are limited to 16 concurrent handlers and host-to-backend calls to 32 pending
calls; queues are bounded. Host-to-backend calls time out after 15 seconds.

The host sends an initialization request and expects a reply within 5 seconds:

```json
{"id":1,"method":"plugin.initialize","params":{"api":1,"plugin":"com.example.diagnostics","data_dir":"…"}}
{"id":1,"result":{"api":1}}
```

Subsequent host-to-backend requests use the same shape. Always echo the
request's `id`. Replies have either `result` (any JSON value) or `error` (a
nonempty string). Replies can arrive out of order.

A hybrid page calls its **own** backend through the SDK:

```js
const report = await nugget.call("backend.call", {
  method: "diagnostics.run",
  params: { target: "example.com" }
});
```

The host assigns plugin identity from the registered frame; pages cannot
select another plugin's backend. `plugin.initialize` is reserved to the host.

A backend can call the [app API](api.md) on the same pipes. Use string ids
(e.g. `"backend-1"`) for backend-originated requests; host requests use numeric
ids. Read and dispatch replies while handling host requests, to avoid deadlock:

```json
{"id":"backend-1","method":"vpn.status","params":{}}
{"id":"backend-1","result":{"status":"connected","server":"…"}}
```

The supervisor supplies the plugin identity. The same Go dispatcher checks
permissions, checksum and enabled state for pages and native callers. Available
methods are `app.info`, `storage.get`, `storage.set`, `vpn.status`, `vpn.traffic`,
`vpn.connect`, `vpn.disconnect`, `connections.list`, `servers.list`,
`servers.add`, `subscriptions.add`, `routing.addRule`, and `notify`.
`app.theme` and `ui.toast` are page-only methods.

Native backends subscribe to VPN events with:

```json
{"id":"backend-2","method":"events.subscribe","params":{"event":"vpn.state"}}
{"id":"backend-2","result":null}
{"event":"vpn.state","data":{"status":"connected"}}
```

Supported subscriptions are `vpn.state` and `vpn.traffic`, both requiring
`state`. They deliver future events; call `vpn.status` for an initial snapshot.

A backend can emit events for its own pages:

```json
{"event":"diagnostics.progress","data":{"percent":50}}
```

The page receives these inside a host-named envelope, preventing a backend
from impersonating VPN state or theme events:

```js
nugget.on("backend.event", ({ event, data }) => {
  if (event === "diagnostics.progress") console.log(data.percent);
});
```

## Runnable example

From the repository root:

```bash
go run ./examples/plugins/native-info -output /tmp/native-info.nuggetplugin
```

This builds a native executable for the current desktop platform and packages
it with a JS panel. Install the output through Settings → Plugins. The panel
calls the backend to report the OS, CPU architecture and logical CPU count.
