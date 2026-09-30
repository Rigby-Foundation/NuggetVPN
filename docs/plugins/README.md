# Plugins

A plugin is a single `.nuggetplugin` file: a zip with a `plugin.json` at its
root. It can bring:

| | Where it shows up |
| --- | --- |
| **Themes** | Settings → Appearance → Theme, under "From plugins" |
| **Fonts** | The font list in Settings → Appearance |
| **Routing setups** | Routing → From plugins |
| **A page** | Under the plugin, in Settings → Plugins |
| **A background page** | Nowhere: it runs, unseen, while the plugin is on |

A plugin with only themes, fonts and routing setups runs no code at all.
Pages are plain HTML and JavaScript. They run in a sandbox and reach the app
through a small message API, and only for what the user allowed when
installing.

## Quick start

The quickest start is the example in
[`examples/plugins/glance`](../../examples/plugins/glance). It has a status
card with a connect button, a theme, and a routing setup that blocks common
trackers:

```
glance/
├── plugin.json
├── icon.svg
├── panel.html
└── routing/
    └── trackers.vflow
```

Copy it, change the `id` in `plugin.json` to your own, and build it:

```bash
go run ./cmd/nuggetplugin path/to/your-plugin
```

This writes `your-plugin.nuggetplugin` next to the folder. It checks the
plugin the way the app does on install, so any mistake shows up here first.
Then install it under **Settings → Plugins → Install a plugin…**.

A minimal plugin that only adds a theme:

```json
{
  "format": 1,
  "id": "com.example.dusk",
  "name": "Dusk",
  "version": "1.0.0",
  "themes": [
    {
      "id": "dusk",
      "name": "Dusk",
      "mode": "dark",
      "background": { "h": 280, "c": 0.03, "l": 0.16 },
      "accent": { "h": 30, "c": 0.15 }
    }
  ]
}
```

## Where to go next

- [plugin.json reference](manifest.md): every field.
- [Themes, fonts and routing setups](content.md): content plugins.
- [Writing pages](pages.md): the SDK, styling, sizing, storage.
- [API reference](api.md): every method and event.
- [Permissions and the sandbox](security.md): what a plugin can and can't
  do, and why.
- [Packaging and publishing](publishing.md): building, versions and updates.
