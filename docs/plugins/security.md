# Permissions and the sandbox

A VPN client sees everything a computer sends, so plugins are built to be
safe to install. They can add to the app, but never reach past what the user
allowed.

## Permissions

The install prompt lists every permission a plugin asks for, and every host
it may contact. An update that asks for more marks the new ones and asks
again.

| Permission | Lets the plugin |
| --- | --- |
| `state` | See whether the VPN is up, through which server, and the traffic (`vpn.status`, `vpn.traffic`, and their events). |
| `connections` | See the open connections: sites, programs and rules (`connections.list`). |
| `profiles` | See the server list: names, protocols, host names (`servers.list`). Never the links, which hold credentials. |
| `control` | Connect, disconnect and switch server (`vpn.connect`, `vpn.disconnect`). |
| `import` | Add servers and subscriptions (`servers.add`, `subscriptions.add`). |
| `routing` | Add routing rules (`routing.addRule`). |
| `notifications` | Show system notifications (`notify`). |

Without any permissions, a plugin can still show its page, read the theme,
show short messages in the app, and use its own storage.

## The sandbox

Pages run in frames sandboxed without `allow-same-origin`. A page has no
origin of its own, so it can't reach:

- the app window or the app's Go methods;
- other plugins' pages or storage;
- cookies, `localStorage` or IndexedDB.

On top of that, every page is served with a Content-Security-Policy that
allows:

- scripts, styles, pictures and fonts only from the plugin itself (and the
  SDK); inline scripts and styles are fine;
- network connections only to the hosts in `network`, over `https` and `wss`;
- no forms, nested frames, workers or plugins (`<object>`).

The sandbox also blocks pop-ups, dialogs, downloads, and navigating the app
window.

The page can only talk to the app by message. The app checks every call
against the plugin's permissions, and checks again in Go for anything that
changes something.

## What plugins can never do

- Read server links, settings, logs or anything else on disk.
- Change the core's configuration directly, or run native code.
- Reach this computer or the local network: `localhost`, IP addresses and
  local names can't be listed in `network`.
- Run anything in the privileged part of the app, which holds the tunnel.
- Pass themselves off as the app. Toasts and notifications always carry the
  plugin's name, and rules a plugin adds get a note saying so.

## For users

- **Before installing:** look at what the plugin asks for. A theme needs
  nothing. A status widget needs `state`. Be wary of a plugin that wants
  `routing` or `import` without a good reason: `routing` can send traffic
  outside the VPN, and `import` can add servers someone else controls.
- **After installing:** turning a plugin off stops its pages at once.
  Removing it deletes its files and storage, but rules it added stay in
  Routing, marked with its name.
