# Packaging and publishing

## Building

```bash
go run ./cmd/nuggetplugin path/to/your-plugin
go run ./cmd/nuggetplugin path/to/your-plugin out/your-plugin.nuggetplugin
```

The first writes `your-plugin.nuggetplugin` next to the folder; the second
names the output. Either way, it checks the plugin exactly as installing it
would, and prints what it asks for:

```
Glance 1.0.0: examples/plugins/glance.nuggetplugin (3 KB)
asks for: state, control
```

A `.nuggetplugin` is an ordinary zip, so any zip tool works too, as long as
`plugin.json` is at the root and not inside a folder. `nuggetplugin` is still
the way to be sure it installs.

## Versions and updates

Installing a plugin with the same `id` as one already installed updates it:

- its files are replaced;
- its storage is kept;
- if the new version asks for permissions the old one didn't have, the
  install prompt marks them and the user has to allow them again.

The app doesn't compare versions, so installing an older version works too.
Change the `version` for every release, so users can tell which one they
have.

Never change the `id`: a plugin with a new id is a different plugin, with
none of the old one's storage.

## Sharing

Put the `.nuggetplugin` file where people can download it: a GitHub
release, your website, a chat. Plugins are installed from a file, and the app
never downloads them by itself.

In your plugin's description or homepage, say:
- what it does;
- why it needs each permission it asks for;
- which hosts it contacts, and what it sends there.

## Checklist

- [ ] `id` is yours and permanent.
- [ ] `version` is bumped.
- [ ] Only the permissions you use.
- [ ] `network` lists only the hosts you contact.
- [ ] The page looks right in light and dark themes, and in a right-to-left
      language.
- [ ] Fonts and pictures are yours to redistribute.
- [ ] `go run ./cmd/nuggetplugin` passes.
