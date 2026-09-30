# Themes, fonts and routing setups

Content needs no code and no permissions: a plugin can be nothing but a
`plugin.json` and a few files.

## Themes

Themes use the same numbers as the theme editor in Settings → Appearance. The
easiest way to find values you like is to build the theme there first, then
copy its numbers.

```json
"themes": [
  {
    "id": "storm",
    "name": "Storm",
    "mode": "dark",
    "background": { "h": 250, "c": 0.03, "l": 0.14 },
    "accent": { "h": 190, "c": 0.13 },
    "image": {
      "file": "images/storm.jpg",
      "blur": 12,
      "brightness": 0.9,
      "saturate": 1,
      "dim": 0.35,
      "panel": 0.65
    }
  }
]
```

| Field | |
| --- | --- |
| `id` | Unique within the plugin, in the same form as a plugin id. |
| `name` | Up to 60 characters, shown in the theme picker. |
| `mode` | `"dark"` or `"light"`. |
| `background.h` | Hue of the page, 0–360. |
| `background.c` | Tint, 0–0.08. 0 is grey. |
| `background.l` | Lightness: 0–0.3 for dark themes, 0.9–1 for light ones. |
| `accent.h` | Hue of buttons, switches and highlights, 0–360. |
| `accent.c` | Vividness of the accent, 0–0.25. |
| `image` | Optional: a picture behind the app. |
| `image.file` | A PNG, JPEG, WebP or GIF in the plugin. |
| `image.blur` | Blur in pixels, 0–40. |
| `image.brightness` | 0.3–1.5; 1 leaves it as it is. |
| `image.saturate` | 0–2; 0 is black and white. |
| `image.dim` | How much of the theme's background colour is washed over it, 0–0.9. |
| `image.panel` | How opaque the app's panels are over it, 0.2 (glassy) to 1 (solid). |

Values outside their range are clamped rather than refused. Colours are in
OKLCH, and the accent's lightness is fixed per mode, so text on buttons
always stays readable.

## Fonts

```json
"fonts": [
  { "name": "Weather Sans", "file": "fonts/weather-sans.woff2" }
]
```

TTF, OTF, WOFF or WOFF2. Each font appears in the font list under its name
and is offered for every language. Letters it lacks are drawn from the
fallback fonts.

Check the font's licence allows you to redistribute it.

## Routing setups

```json
"routing": [
  {
    "name": "Streaming direct",
    "description": "Netflix, YouTube and Twitch outside the VPN.",
    "file": "routing/streaming.vflow"
  }
]
```

A `.vflow` file is a whole routing graph, the same file Routing → Export
saves. Build the setup in the app, export it, and put the file in your
plugin. Using one from Routing → From plugins replaces the user's routing;
the user can undo it.

Setups that refer to specific servers lose those links on someone else's
computer, since their servers are different. Rules that send traffic
"through the VPN", "direct" or "block" work everywhere.
