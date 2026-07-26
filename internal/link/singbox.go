package link

import (
	"encoding/json"
	"fmt"
	"strings"
)

// FullConfig reports whether a stored profile is a complete sing-box config
// that should be run verbatim. A config only qualifies when it declares its own
// inbounds; a bare `outbounds` document is treated as a proxy source instead so
// the app can still layer its own TUN, DNS and routing on top.
func FullConfig(raw string) (map[string]any, bool) {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "{") {
		return nil, false
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
		return nil, false
	}
	inbounds, ok := root["inbounds"].([]any)
	if !ok || len(inbounds) == 0 {
		return nil, false
	}
	return root, true
}

// outboundFromSingBoxJSON accepts either a single outbound object or a config
// document and returns the outbound the profile should dial through.
func outboundFromSingBoxJSON(raw string) (Outbound, error) {
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return nil, fmt.Errorf("invalid sing-box JSON: %w", err)
	}

	// A bare outbound object.
	if _, hasOutbounds := root["outbounds"]; !hasOutbounds {
		if stringValue(root["type"]) == "" {
			return nil, fmt.Errorf("sing-box JSON has neither `outbounds` nor a `type`")
		}
		return sanitizeOutbound(root), nil
	}

	selected, err := selectSingBoxOutbound(root)
	if err != nil {
		return nil, err
	}
	return sanitizeOutbound(selected), nil
}

// sanitizeOutbound strips fields the config builder owns, so a pasted outbound
// cannot fight with the generated tags and chain wiring.
func sanitizeOutbound(source map[string]any) Outbound {
	outbound := make(Outbound, len(source))
	for key, value := range source {
		switch key {
		case "tag", "detour":
			continue
		}
		outbound[key] = value
	}
	// sing-box renamed `port` to `server_port`; accept both on input.
	if _, ok := outbound["server_port"]; !ok {
		if port := intValue(outbound["port"]); port > 0 {
			outbound["server_port"] = port
			delete(outbound, "port")
		}
	}
	return outbound
}

// selectSingBoxOutbound resolves the outbound a config actually exits through,
// following `route.final` and selector/urltest groups down to a real protocol.
func selectSingBoxOutbound(root map[string]any) (map[string]any, error) {
	rawOutbounds, ok := root["outbounds"].([]any)
	if !ok || len(rawOutbounds) == 0 {
		return nil, fmt.Errorf("no supported outbound found in sing-box config")
	}

	outbounds := make([]map[string]any, 0, len(rawOutbounds))
	for _, item := range rawOutbounds {
		if outbound, ok := item.(map[string]any); ok {
			outbounds = append(outbounds, outbound)
		}
	}

	preferred := make([]string, 0, 4)
	if route, ok := root["route"].(map[string]any); ok {
		if final := strings.TrimSpace(stringValue(route["final"])); final != "" {
			preferred = append(preferred, final)
		}
	}
	preferred = append(preferred, "proxy", "select", "auto")

	for _, tag := range preferred {
		if resolved := resolveLeafByTag(outbounds, tag, map[string]bool{}); resolved != nil {
			if isDialableOutbound(resolved) {
				return resolved, nil
			}
		}
	}

	// Fall back to walking any selector group, then any dialable outbound.
	for _, outbound := range outbounds {
		if !isSelectorLike(stringValue(outbound["type"])) {
			continue
		}
		tag := strings.TrimSpace(stringValue(outbound["tag"]))
		if tag == "" {
			continue
		}
		if resolved := resolveLeafByTag(outbounds, tag, map[string]bool{}); resolved != nil {
			if isDialableOutbound(resolved) {
				return resolved, nil
			}
		}
	}
	for _, outbound := range outbounds {
		if isDialableOutbound(outbound) {
			return outbound, nil
		}
	}
	return nil, fmt.Errorf("no supported outbound found in sing-box config")
}

func resolveLeafByTag(outbounds []map[string]any, tag string, visited map[string]bool) map[string]any {
	normalized := strings.TrimSpace(tag)
	if normalized == "" || visited[normalized] {
		return nil
	}
	visited[normalized] = true

	var found map[string]any
	for _, outbound := range outbounds {
		if strings.TrimSpace(stringValue(outbound["tag"])) == normalized {
			found = outbound
			break
		}
	}
	if found == nil {
		return nil
	}
	if !isSelectorLike(stringValue(found["type"])) {
		return found
	}

	if defaultTag := strings.TrimSpace(stringValue(found["default"])); defaultTag != "" {
		if resolved := resolveLeafByTag(outbounds, defaultTag, visited); resolved != nil {
			return resolved
		}
	}
	if nested, ok := found["outbounds"].([]any); ok {
		for _, item := range nested {
			if resolved := resolveLeafByTag(outbounds, stringValue(item), visited); resolved != nil {
				return resolved
			}
		}
	}
	return nil
}

func isSelectorLike(outboundType string) bool {
	switch outboundType {
	case "selector", "urltest", "fallback":
		return true
	}
	return false
}

// isDialableOutbound filters out the pseudo outbounds that carry no endpoint.
func isDialableOutbound(outbound map[string]any) bool {
	switch stringValue(outbound["type"]) {
	case "", "direct", "block", "dns", "selector", "urltest", "fallback":
		return false
	}
	if strings.TrimSpace(stringValue(outbound["server"])) == "" {
		return false
	}
	return intValue(outbound["server_port"]) > 0 || intValue(outbound["port"]) > 0
}
