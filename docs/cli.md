# The command line

The app's own program also works as a command: it controls the copy that is
running, from a terminal, a script or a keyboard shortcut.

```
NuggetVPN status
NuggetVPN connect Tokyo
NuggetVPN disconnect
```

The app has to be running (it can be minimised to the tray). With no app
running, commands say so and exit with code 2.

## Commands

| Command | |
| --- | --- |
| `status` | Whether the VPN is up, through which server, for how long, and the traffic. |
| `connect [server]` | Connects. With a server, by its id, its exact name, or a part of its name that matches only one server. Without, to the server last used. |
| `disconnect` | Disconnects. |
| `servers [search]` | Lists the servers, the current one marked with `*`, optionally only those whose names contain `search`. |
| `setup [name]` | Lists the routing setups, the active one marked with `*`, or switches to one by name. |
| `speedtest` | Runs a speed test through the current server and prints download, upload, ping and jitter. |
| `help` | Lists the commands. |

Add `--json` to any command to get JSON instead of text, for scripts:

```
$ NuggetVPN status --json
{"status":"connected","profile_id":"p-de","profile":"Frankfurt 1","since":1790000000000}
```

## Exit codes

| Code | |
| --- | --- |
| 0 | Done. |
| 1 | The app refused: no such server, not connected for a speed test, and so on. The reason is printed. |
| 2 | The app isn't running. |

## Where the program is

| System | |
| --- | --- |
| Windows | `C:\Program Files\Rigby Foundation\NuggetVPN\NuggetVPN.exe`, or where you installed it |
| macOS | `/Applications/NuggetVPN.app/Contents/MacOS/NuggetVPN` |
| Linux | `/usr/bin/NuggetVPN` from the .deb or .rpm, or the AppImage itself |

On macOS, an alias makes it easier:

```bash
alias nuggetvpn=/Applications/NuggetVPN.app/Contents/MacOS/NuggetVPN
```

### Windows

NuggetVPN is a window program, and Windows doesn't wait for those to finish.
In `cmd`, the prompt comes back before the output appears. In PowerShell,
piping the output makes it wait:

```powershell
& "C:\Program Files\Rigby Foundation\NuggetVPN\NuggetVPN.exe" status | Write-Output
```

Scripts that read the output or the exit code, or that redirect it, work as
usual.

## Security

The running app listens on a socket in your own user folder, and every
command carries a token from a file that only your account can read. Other
accounts on the same computer can't use it.
