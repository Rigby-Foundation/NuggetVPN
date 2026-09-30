# Writing pages

A plugin can have two pages, both plain HTML:

- a **panel**, shown under the plugin in Settings → Plugins;
- a **background** page, kept running unseen while the plugin is on. Use it
  to react to events, like a notification when the connection drops.

## The SDK

Include the SDK, and use the global `nugget`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="/plugins/_sdk/nugget.js"></script>
</head>
<body>
  <p id="status">…</p>
  <script>
    const show = (state) => {
      document.getElementById("status").textContent = state.status;
    };
    nugget.call("vpn.status").then(show);
    nugget.on("vpn.state", show);
  </script>
</body>
</html>
```

| | |
| --- | --- |
| `nugget.call(method, params?)` | Calls an app method. Returns a promise of its result, or rejects with an `Error` whose message says what went wrong. |
| `nugget.on(event, handler)` | Listens for an event. Returns a function that stops listening. |
| `nugget.fit()` | Asks the app to size the panel to its content. The SDK already does this whenever the page's size changes. |

Every method and event is in the [API reference](api.md).

## Looking like the app

The SDK dresses the page in the user's theme and keeps it current:

- **Colours:** set as CSS variables on `<html>`:
  - `--background`, `--foreground`, `--card`, `--card-foreground`;
  - `--primary`, `--primary-foreground`, `--secondary`, `--muted`,
    `--muted-foreground`, `--accent`;
  - `--border`, `--input`, `--ring`, `--destructive`;
  - `--status-connected`, `--status-connecting`, `--status-error`,
    `--status-idle`.
- **Shape:** `--radius`, the app's corner radius.
- **Attributes:** `color-scheme`, `data-theme="light|dark"`, `lang` and
  `dir` (Persian is right to left).

Leave the page background transparent and it sits in the app like part of it:

```css
html { background: transparent; color: var(--foreground); font: 13px/1.4 system-ui, sans-serif; }
button { background: var(--primary); color: var(--primary-foreground); border: 0; border-radius: var(--radius); }
.muted { color: var(--muted-foreground); }
```

The app's own fonts aren't available inside the page; use a system font
stack, or bring a font in the plugin.

## Size

A panel is as wide as the plugin's card and sizes itself to its content,
between 60 and 4000 pixels high. Avoid `height: 100vh` layouts: the frame
takes the height of what's in it.

## Storing things

Each plugin has its own storage of up to 1 MB of JSON, kept across restarts
and updates, and deleted when the plugin is removed:

```js
const count = (await nugget.call("storage.get", { key: "count" })) ?? 0;
await nugget.call("storage.set", { key: "count", value: count + 1 });
```

`localStorage` and cookies don't work in the sandbox.

## What doesn't work

Pages run in a sandbox; see [permissions and the sandbox](security.md).
In short:

- no forms (use JavaScript and `nugget.call`);
- no pop-ups, `alert` or new windows;
- no nested frames;
- no `eval` or `new Function`;
- no network except the hosts in `network`;
- no scripts, styles or pictures from anywhere but your own plugin.

Links to your plugin's own files work with absolute paths,
`/plugins/<your id>/file.png`, or relative ones.

## Debugging

In a development build (`make dev`), Shift + right-click the page and choose
Inspect to open the developer tools, then pick your plugin's frame in the
console's context selector. `console.log` output shows up there.
