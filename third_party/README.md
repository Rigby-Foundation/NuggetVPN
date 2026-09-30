# Vendored cores

Official sing-box is linked into the app beside the TodayCore fork, which
takes its module path (`github.com/sagernet/sing-box`, via a replace in the
root `go.mod`). Go allows one copy of a module path per build, so the
official release is copied here under a module path of its own.

## sing-box-official

sing-box **v1.15.0-alpha.9**, with every import of
`github.com/sagernet/sing-box` rewritten to
`github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official`, and
of `github.com/sagernet/sing-tun` to `.../third_party/sing-tun-official`.

The macOS C and Objective-C code (`common/tls`, `common/httpclient`,
`common/certificate`, `service/powerreport`, `service/oomkiller`) has its
global symbols renamed with an `nvpn` prefix (`box_apple_` to
`nvpn_box_apple_`, `BoxAppleHTTPSession` to `NVPNBoxAppleHTTPSession`,
`box_certificate_`, `boxPower`, `goMemoryPressureCallback` likewise): C has
one namespace per binary, and the fork defines the same ones.

Removed, because they cannot share a process with the fork or are not used:

- `protocol/tailscale`, `include/tailscale.go`, `service/derp` — Tailscale
  needs a newer sing-tun than the fork, and one module version is shared.
- `daemon`, `service/api`, `experimental/libbox` — protobuf registers
  message types globally, and the fork registers the same ones.
- `experimental/boxdd`, `cmd`, tests, docs, `release`, `clients`, the
  Dockerfiles and the Makefile.

## sing-tun-official

The sing-tun version official sing-box 1.15.0-alpha.9 requires, under a
module path of its own: its API differs from the version the fork needs.

## Updating

Copy the new release over, repeat the import rewrite, the symbol renames
and the removals above, and run `go build ./... && go test ./internal/...`. A protobuf
"namespace conflict" panic at start means another package both copies
register has been linked in; "duplicate symbol" from the macOS linker means
more C symbols to rename.
