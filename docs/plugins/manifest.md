# plugin.json

Every plugin has a `plugin.json` at the root of its zip.

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

  "themes": [ … ],
  "fonts": [ … ],
  "routing": [ … ],

  "panel": { "title": "Weather", "file": "panel.html" },
  "background": "background.html",

  "permissions": ["state", "profiles", "notifications"],
  "network": ["status.example.com"]
}
```

## About the plugin

| Field | Required | |
| --- | --- | --- |
| `format` | yes | Always `1`. A newer app may read newer formats; this one refuses others and says so. |
| `id` | yes | Your plugin's permanent id. Use 3–64 lowercase letters, digits, `.`, `-` and `_`, starting and ending with a letter or digit. A reversed domain works well: `com.example.weather`. An update must keep the same id. |
| `name` | yes | Up to 60 characters. |
| `version` | yes | Any version string of letters, digits, `.`, `+` and `-`, up to 32 characters. Shown to the user; the app doesn't compare versions. |
| `author` | | Up to 80 characters. |
| `description` | | Up to 500 characters, shown in the install prompt and the plugin list. |
| `homepage` | | An `https://` address. It is shown, never opened by the app. |
| `icon` | | A PNG, JPEG, WebP or SVG file in the plugin. Shown square, at 36–40 px. |

## Content

| Field | |
| --- | --- |
| `themes` | Custom themes. See [content](content.md#themes). |
| `fonts` | Font files. See [content](content.md#fonts). |
| `routing` | `.vflow` routing setups. See [content](content.md#routing-setups). |

## Pages

| Field | |
| --- | --- |
| `panel` | `{ "title": "…", "file": "panel.html" }`: a page shown under the plugin in Settings → Plugins. `title` is up to 40 characters and defaults to the plugin's name. |
| `background` | `"background.html"`: a page kept running while the plugin is on. |

See [writing pages](pages.md).

## Access

| Field | |
| --- | --- |
| `permissions` | What the plugin's pages may do. See [permissions](security.md#permissions). Ask only for what you use; the install prompt lists every one. |
| `network` | Host names your pages may contact, over `https` and `wss`, like `api.example.com` or `*.example.com`. Nothing else is reachable. IP addresses, `localhost` and local names (`.local`, `.lan`, `.internal`, `.home.arpa`) are refused. Only allowed for plugins with a page. |

## Files

File names may use letters, digits, `.`, `-` and `_`, in folders separated by
`/`. Names can't start with a dot. Every file the manifest names must be in
the plugin, with the right kind of extension.

A plugin can be at most 50 MB, with at most 500 files of up to 25 MB each,
and 80 MB unpacked.

Files are served with a type decided by extension. Anything else is not
served:

`.html`, `.js`, `.mjs`, `.css`, `.json`, `.svg`, `.png`, `.jpg`, `.jpeg`,
`.webp`, `.gif`, `.ttf`, `.otf`, `.woff`, `.woff2`, `.txt`
