package sbconfig

import (
	"encoding/json"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Lockdown is the configuration the kill switch runs while the tunnel is
// being brought back: the same TUN interface, so the system's traffic still
// has to go through it, but with nothing behind it — every connection is
// refused, every name lookup fails.
//
// Two things still get out. The local network, which the TUN excludes
// anyway. And this app itself (ownPath, its executable): it has to reach the
// servers to measure and reconnect to them, and to refresh a subscription
// whose servers all changed.
func Lockdown(settings models.AppSettings, ownPath string) ([]byte, error) {
	settings.Normalize()

	rules := []map[string]any{
		// Local names and addresses stay reachable, as when connected.
		{"ip_is_private": true, "outbound": DirectTag},
	}
	if ownPath != "" {
		rules = append(rules, map[string]any{"process_path": []string{ownPath}, "outbound": DirectTag})
	}
	rules = append(rules,
		// Name lookups are answered here and refused, so nothing leaks to
		// the network's resolver.
		map[string]any{"port": []int{53}, "action": "hijack-dns"},
		map[string]any{"action": "reject"},
	)

	config := map[string]any{
		"log":      buildLog(settings),
		"inbounds": buildInbounds(settings, 0, nil),
		"outbounds": []map[string]any{
			{"type": "direct", "tag": DirectTag},
		},
		"dns": map[string]any{
			"servers": []map[string]any{
				{"type": "local", "tag": dnsLocalTag},
			},
			"rules": []map[string]any{
				{"domain_suffix": localSuffixes, "server": dnsLocalTag},
				{"action": "reject"},
			},
			"final": dnsLocalTag,
		},
		"route": map[string]any{
			"rules":                 rules,
			"final":                 DirectTag,
			"auto_detect_interface": true,
			"find_process":          true,
		},
	}
	return json.MarshalIndent(config, "", "  ")
}
