# API reference

Pages call methods with `nugget.call(method, params)` and listen for events
with `nugget.on(event, handler)`; see [writing pages](pages.md).

A method that needs a permission the plugin wasn't given fails with an error
saying which. So does a method called while the plugin is turned off.

## Methods

### App

| Method | Permission | Params | Returns |
| --- | --- | --- | --- |
| `app.info` | — | | `{ version, language, platform, plugin: { id, version, permissions } }` |
| `app.theme` | — | | The theme the SDK applies; see [below](#apptheme). |
| `ui.toast` | — | `{ text, kind? }` | `null`. Shows a short message, prefixed with the plugin's name. `kind` is `"info"` (default), `"success"` or `"error"`. At most one every 1.5 seconds. |
| `storage.get` | — | `{ key }` | The stored JSON value, or `null`. |
| `storage.set` | — | `{ key, value }` | `null`. `value` is any JSON value; `null` removes the key. Keys are up to 200 characters, and everything together up to 1 MB. |
| `notify` | `notifications` | `{ title, body }` | `null`. A system notification, titled "Plugin name: title". At most one every 10 seconds. The user may have notifications turned off. |

### Connection

| Method | Permission | Params | Returns |
| --- | --- | --- | --- |
| `vpn.status` | `state` | | A [state](#state). |
| `vpn.traffic` | `state` | | A [traffic sample](#traffic). |
| `vpn.connect` | `control` | `{ server? }` | A [state](#state). Connects to a server id from `servers.list`, or to what is selected in the app. Resolves once connected, or rejects if no server worked. |
| `vpn.disconnect` | `control` | | `null` |
| `connections.list` | `connections` | | The open connections; see [below](#connection). |

### Servers and routing

| Method | Permission | Params | Returns |
| --- | --- | --- | --- |
| `servers.list` | `profiles` | | `[{ id, name, protocol, host, favorite, subscription }]`. `subscription` is the subscription's domain, or `null`. Never the links, which hold credentials. |
| `servers.add` | `import` | `{ link, name? }` | `null`. Adds a server from a share link (`vless://`, `ss://`, …). |
| `subscriptions.add` | `import` | `{ url }` | `null`. Adds and fetches a subscription. |
| `routing.addRule` | `routing` | `{ kind, values, action, invert? }` | `null`. Adds a rule at the end of the user's routing, with a note saying your plugin added it, and applies it. |

`routing.addRule`:

| Param | |
| --- | --- |
| `kind` | `apps` (program names), `domains`, `ip` (addresses and CIDR ranges), `domain_regex`, `port` (numbers and ranges like `8000-8080`), `protocol` (`bittorrent`, `quic`, …), `geosite`, `geoip` (country codes like `ru`), `network` (`tcp`, `udp`), `ruleset` (rule list URLs). |
| `values` | The values to match, up to 5000. |
| `action` | `proxy` (through the VPN), `direct`, or `block`. |
| `invert` | Match everything the values don't. |

## Events

| Event | Permission | Data |
| --- | --- | --- |
| `vpn.state` | `state` | A [state](#state): sent once when you subscribe, then on every change. |
| `vpn.traffic` | `state` | A [traffic sample](#traffic), once a second while connected. |
| `app.theme` | — | The [theme](#apptheme), whenever the user changes it. The SDK applies it for you. |

## Types

### State

```json
{
  "status": "connected",
  "server": "Frankfurt 1",
  "server_id": "p-de",
  "since": 1790000000000,
  "reconnecting": false,
  "blocked": false,
  "error": null
}
```

| Field | |
| --- | --- |
| `status` | `idle`, `connecting`, `connected` or `error`. |
| `server`, `server_id` | The server, while connecting or connected. |
| `since` | When the tunnel came up, in unix milliseconds. |
| `reconnecting` | The tunnel dropped and is being brought back. |
| `blocked` | The kill switch is holding all traffic. |
| `error` | What went wrong, when `status` is `error`. |

### Traffic

```json
{ "up": 12000000, "down": 340000000, "up_rate": 42000, "down_rate": 1830000, "total_up": 0, "total_down": 0 }
```

`up` and `down` are bytes this session; the rates are bytes per second.

### Connection

```json
{
  "id": "…",
  "network": "tcp",
  "protocol": "tls",
  "host": "www.example.com",
  "destination": "93.184.216.34:443",
  "app": "chrome.exe",
  "rule": "rule-1",
  "route": "proxy",
  "server": "p-de",
  "upload": 1200,
  "download": 48000,
  "started": 1790000000000
}
```

`rule` is the id of the routing rule that matched, `"__default"` for
everything else, or `""` for connections the app routes itself.

### app.theme

```json
{
  "mode": "dark",
  "colors": { "background": "oklch(…)", "foreground": "…", "primary": "…" },
  "radius": "0.625rem",
  "font": "…",
  "language": "en",
  "dir": "ltr"
}
```

## Low-level protocol

The SDK wraps `postMessage`. You don't need this unless you're writing your
own SDK:

- **Page to app:**
  - `{ nugget: 1, id, method, params }`: a call;
  - `{ nugget: 1, subscribe: "event" }`: listen for an event;
  - `{ nugget: 1, hello: true }`: the page has loaded;
  - `{ nugget: 1, height }`: the panel's height.
- **App to page:**
  - `{ nugget: 1, id, result }` or `{ nugget: 1, id, error }`: an answer;
  - `{ nugget: 1, event, data }`: an event.
