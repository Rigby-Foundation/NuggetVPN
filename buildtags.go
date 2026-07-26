//go:build !with_utls || !with_quic || !with_gvisor || !with_wireguard || !with_clash_api

package main

// This file exists to break the build when a required sing-box feature tag is
// missing, because every one of them fails silently at runtime instead:
//
//	with_utls        VLESS Reality (sing-box implements Reality on top of uTLS)
//	with_quic        Hysteria, Hysteria2 and TUIC
//	with_gvisor      the userspace network stack the TUN interface uses
//	with_wireguard   WireGuard endpoints
//	with_clash_api   the traffic counters shown in the UI
//
// Build with `make build` / `make dev`, or pass the tags yourself:
//
//	wails build -tags "$(make -s tags)"
func init() {
	_ = missing_required_sing_box_build_tags_run_make_build
}
