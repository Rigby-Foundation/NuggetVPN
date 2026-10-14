package link

import (
	"encoding/json"
	"strings"
)

// XrayConfigsAsLinks reads a subscription served as a JSON array of whole
// Xray configs — what Remnawave sends Happ 4 and newer, one config per
// entry, named by its "remarks" — and writes it as the share-link list the
// rest of the subscription code reads, one link per config, named as the
// entry. An entry that balances several servers (an "auto" pick) becomes
// the server it falls back to, as the same subscription lists it in link
// form. Placeholder and separator entries come out as the placeholder links
// they are, so they are skipped or become sections as usual. ok is false
// when the body is not such an array.
func XrayConfigsAsLinks(body string) (string, bool) {
	trimmed := strings.TrimSpace(body)
	if !strings.HasPrefix(trimmed, "[") {
		return "", false
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(trimmed), &configs); err != nil || len(configs) == 0 {
		return "", false
	}
	var lines []string
	for _, config := range configs {
		outbounds, _ := config["outbounds"].([]any)
		if len(outbounds) == 0 {
			continue
		}
		picked := pickXrayServer(config, outbounds)
		if picked == nil {
			continue
		}
		servers := configServers(map[string]any{"outbounds": []any{picked}})
		if len(servers) == 0 {
			continue
		}
		name := strings.TrimSpace(stringValue(config["remarks"]))
		if name == "" {
			name = stringValue(picked["tag"])
		}
		encoded, err := EncodeShareLink(servers[0], name)
		if err != nil {
			continue
		}
		lines = append(lines, encoded)
	}
	if len(lines) == 0 {
		return "", false
	}
	return strings.Join(lines, "\n"), true
}

// pickXrayServer is the outbound a config's traffic goes through: the
// balancer's fallback when it balances, otherwise its first server.
func pickXrayServer(config map[string]any, outbounds []any) map[string]any {
	byTag := map[string]map[string]any{}
	var first map[string]any
	for _, item := range outbounds {
		outbound, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.ToLower(stringValue(outbound["protocol"])) {
		case "freedom", "blackhole", "dns", "loopback", "":
			continue
		}
		byTag[stringValue(outbound["tag"])] = outbound
		if first == nil {
			first = outbound
		}
	}
	if routing, _ := config["routing"].(map[string]any); routing != nil {
		if balancers, _ := routing["balancers"].([]any); len(balancers) > 0 {
			if balancer, _ := balancers[0].(map[string]any); balancer != nil {
				if fallback, ok := byTag[stringValue(balancer["fallbackTag"])]; ok {
					return fallback
				}
			}
		}
	}
	return first
}
