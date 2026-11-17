package xrayconfig

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Rigby-Foundation/Kage/internal/link"
	"github.com/Rigby-Foundation/Kage/internal/models"
)

// Export uses the same native conversion and validation as a connection.
// An export must not lose unsupported profiles or transport options silently.
func Export(profiles []models.Profile, settings models.AppSettings, full bool) (string, error) {
	if len(profiles) == 0 {
		return "", fmt.Errorf("no profiles to export")
	}
	outbounds := []any{}
	used := map[string]bool{"direct": true, "block": true}
	first := ""
	for _, profile := range profiles {
		if err := Check(profile, settings); err != nil {
			return "", fmt.Errorf("%s: %w", profile.Name, err)
		}
		source, err := link.ParseOutbound(profile.ConfigLink, settings)
		if err != nil {
			return "", err
		}
		outbound, err := convert(source)
		if err != nil {
			return "", err
		}
		base := strings.TrimSpace(profile.Name)
		if base == "" {
			base = "proxy"
		}
		tag := base
		for index := 2; used[tag]; index++ {
			tag = fmt.Sprintf("%s (%d)", base, index)
		}
		used[tag] = true
		outbound["tag"] = tag
		if first == "" {
			first = tag
		}
		outbounds = append(outbounds, outbound)
	}
	root := map[string]any{"outbounds": outbounds}
	if full {
		root["log"] = map[string]any{"loglevel": "warning"}
		root["inbounds"] = []any{
			map[string]any{"tag": "socks-in", "listen": "127.0.0.1", "port": 10808, "protocol": "socks", "settings": map[string]any{"auth": "noauth", "udp": true}},
			map[string]any{"tag": "http-in", "listen": "127.0.0.1", "port": 10809, "protocol": "http"},
		}
		root["outbounds"] = append(outbounds, map[string]any{"tag": "direct", "protocol": "freedom"}, map[string]any{"tag": "block", "protocol": "blackhole"})
		root["routing"] = map[string]any{"rules": []any{map[string]any{"type": "field", "inboundTag": []string{"socks-in", "http-in"}, "outboundTag": first}}}
	}
	data, err := json.MarshalIndent(root, "", "  ")
	return string(data), err
}
