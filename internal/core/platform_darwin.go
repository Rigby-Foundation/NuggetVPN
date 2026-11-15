//go:build darwin && !ios

package core

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"os/exec"
	"strings"
)

// macOS leaves system DNS to the host. Route its existing resolver addresses
// into the TUN as well, including LAN resolvers whose /24 would otherwise win
// over the VPN's default routes. Xray owns and removes these routes on Close.
func preparePlatform(config []byte) ([]byte, func(), error) {
	var root map[string]any
	if err := json.Unmarshal(config, &root); err != nil {
		return nil, nil, err
	}
	inbounds, _ := root["inbounds"].([]any)
	for _, entry := range inbounds {
		inbound, _ := entry.(map[string]any)
		if inbound["protocol"] != "tun" {
			continue
		}
		settings, _ := inbound["settings"].(map[string]any)
		if settings == nil {
			continue
		}
		if _, desktop := settings["autoSystemRoutingTable"]; !desktop {
			continue
		}
		output, err := exec.Command("/usr/sbin/scutil", "--dns").Output()
		if err != nil {
			return nil, nil, fmt.Errorf("read macOS DNS configuration: %w", err)
		}
		routes, _ := settings["autoSystemRoutingTable"].([]any)
		seen := map[string]bool{}
		for _, line := range strings.Split(string(output), "\n") {
			if !strings.Contains(line, "nameserver[") {
				continue
			}
			_, value, ok := strings.Cut(line, " : ")
			if !ok {
				continue
			}
			address, err := netip.ParseAddr(strings.TrimSpace(value))
			if err != nil || address.IsLoopback() || address.IsUnspecified() {
				continue
			}
			address = address.WithZone("")
			cidr := netip.PrefixFrom(address, address.BitLen()).String()
			if !seen[cidr] {
				routes = append(routes, cidr)
				seen[cidr] = true
			}
		}
		settings["autoSystemRoutingTable"] = routes
	}
	data, err := json.Marshal(root)
	return data, func() {}, err
}
