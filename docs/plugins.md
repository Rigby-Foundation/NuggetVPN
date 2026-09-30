# Writing a NuggetVPN plugin

A plugin is a single `.nuggetplugin` file: a zip with a `plugin.json` at its
root. It can bring:

- **themes**, which appear under Appearance → Theme;
- **fonts**, which appear in the font list;
- **routing setups** (`.vflow` files), under Routing → From plugins;
- **a page** of its own under Settings → Plugins;
- **a background page** that runs, unseen, while the plugin is on.

Pages are plain HTML and JavaScript. They talk to the app through a small
message API, and can only do what the user allowed when installing.

The quickest start is the example in
[`examples/plugins/glance`](../examples/plugins/glance). It has a status card,
a theme and a routing setup.

## Building and installing

```bash
go run ./cmd/nuggetplugin examples/plugins/glance
```

This writes `examples/plugins/glance.nuggetplugin`. It checks the plugin
exactly the way the app does on install, so any mistake shows up here first.

Install the file under **Settings → Plugins → Install a plugin…**. Installing
a new version over an old one keeps the plugin's saved data. If the new
version asks for permissions the old one didn't have, the app asks again.

## plugin.json

```json
{
  "format": 1,
  "id": "com.example.weather",
  "name": "Server weather",
  "version": "1.0.0",
  "author": "You",
  "description": "What it does, in a sentence or two.",
  "homepage": "https://example.com/weather",
  "icon": "icon.png",

  "themes": [
    {
      "id": "storm",
      "name": "Storm",
      "mode": "dark",
      "background": { "h": 250, "c": 0.03, "l": 0.14 },
      "accent": { "h": 190, "c": 0.13 },
      "image": { "file": "images/storm.jpg", "blur": 12, "brightness": 0.9, "saturate": 1, "dim": 0.35, "panel": 0.65 }
    }
  ],
  "fonts": [{ "name": "Weather Sans", "file": "fonts/weather-sans.woff2" }],
  "routing": [{ "name": "Streaming direct", "description": "Optional", "file": "routing/streaming.vflow" }],

  "panel": { "title": "Weather", "file": "panel.html" },
  "background": "background.html",

  "permissions": ["state", "profiles", "notifications"],
  "network": ["status.example.com"]
}
```

| Field | |
| --- | --- |
| `format` | Always `1`. |
| `id` | Your plugin's permanent id: lowercase letters, digits, `.`, `-`, `_`, like a reversed domain. An update must keep it. |
| `version` | Any version string, shown to the user. |
| `homepage` | Shown, never opened automatically. Must be `https://`. |
| `icon` | PNG, JPEG, WebP or SVG. |
| `themes` | The same numbers as the theme editor. **Background:** `h` is hue (0–360), `c` is tint (0–0.08), and `l` is lightness (0–0.3 for dark themes, 0.9–1 for light ones). **Accent:** `h` is hue and `c` is vividness (0–0.25). Out-of-range values are clamped. `image` is optional; its fields are also clamped. |
| `fonts` | TTF, OTF, WOFF or WOFF2. |
| `routing` | `.vflow` files, as Routing → Export saves them. Using one replaces the user's routing; they can undo it. |
| `panel` | A page shown under the plugin in Settings → Plugins. It sizes itself to its content. |
| `background` | A page kept running while the plugin is on. |
| `permissions` | See below. Ask only for what you use. |
| `network` | Hosts your pages may contact, over `https` and `wss`. Nothing else is reachable. Addresses, `localhost` and local names are refused. |

File names may use letters, digits, `.`, `-` and `_`, in folders. A plugin
can be at most 50 MB, with at most 500 files of up to 25 MB each.

## Pages

Include the SDK and use `nugget`:

```html
<script src="/plugins/_sdk/nugget.js"></script>
<script>
  const state = await nugget.call("vpn.status");
  nugget.on("vpn.state", (state) => console.log(state.status));
</script>
```

- **Theme:** the SDK dresses the page in the app's theme. It sets the colours
  as CSS variables on `<html>` and keeps them current:
  - `--background`, `--foreground`, `--card`, `--primary`,
    `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`,
    `--destructive`;
  - `--status-connected`, `--status-connecting`, `--status-error`,
    `--status-idle`;
  - plus `--radius`, `color-scheme`, `lang` and `dir`.

  Leave the page background transparent and it sits in the app like part of
  it.
- **Sandbox:** pages run in a sandboxed frame. They have no access to the app
  window, cookies, other plugins, or the rest of the file system. Forms,
  pop-ups, nested frames and navigating the app are blocked.
- **Loading and network:** pages load code, styles, pictures and fonts only
  from the plugin itself. They reach the network only at the hosts in
  `network`.

### Methods

| Method | Permission | Params | Returns |
| --- | --- | --- | --- |
| `app.info` | — | | `{ version, language, platform, plugin: { id, version, permissions } }` |
| `app.theme` | — | | the theme the SDK applies |
| `ui.toast` | — | `{ text, kind?: "info" \| "success" \| "error" }` | Shown with your plugin's name. |
| `storage.get` | — | `{ key }` | the stored JSON value, or `null` |
| `storage.set` | — | `{ key, value }` | `null` removes the key. 1 MB per plugin. |
| `vpn.status` | `state` | | `{ status, server, server_id, since, reconnecting, blocked, error }` |
| `vpn.traffic` | `state` | | `{ up, down, up_rate, down_rate, total_up, total_down }` (bytes, and bytes a second) |
| `vpn.connect` | `control` | `{ server? }` | Connects to a server id from `servers.list`, or to whatever is selected. |
| `vpn.disconnect` | `control` | | |
| `connections.list` | `connections` | | the open connections, as the Connections screen shows them |
| `servers.list` | `profiles` | | `[{ id, name, protocol, host, favorite, subscription }]`. Never the links, which hold credentials. |
| `servers.add` | `import` | `{ link, name? }` | Adds a server from a share link. |
| `subscriptions.add` | `import` | `{ url }` | Adds a subscription. |
| `routing.addRule` | `routing` | `{ kind, values, action, invert? }` | Adds a rule. `kind` is one of `apps`, `domains`, `ip`, `domain_regex`, `port`, `protocol`, `geosite`, `geoip`, `network`, `ruleset`. `action` is one of `proxy`, `direct`, `block`. The rule gets a note saying your plugin added it. |
| `notify` | `notifications` | `{ title, body }` | A system notification, titled with your plugin's name. At most one every 10 seconds. |

A call without the permission it needs fails with an error saying so.

### Events

| Event | Permission | Data |
| --- | --- | --- |
| `vpn.state` | `state` | as `vpn.status`; sent once when you subscribe, then on every change |
| `vpn.traffic` | `state` | as `vpn.traffic`, once a second while connected |
| `app.theme` | — | the theme, whenever the user changes it (the SDK applies it for you) |

## What plugins can't do

Plugins exist for sharing looks, setups and small tools, not for changing how
the tunnel works:
- They can't change the core's configuration, read your server links or
  settings, or run native code.
- They can't reach anything on your computer or local network.
- Nothing a plugin brings runs in the privileged part of the app.

If you need something the API doesn't offer, open an issue describing what
you want to build.
