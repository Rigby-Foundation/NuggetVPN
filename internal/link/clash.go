package link

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// looksLikeClashYAML detects profiles saved by the previous clash-rs based
// builds so they keep working after the migration to sing-box.
func looksLikeClashYAML(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	for _, prefix := range []string{"proxies:", "port:", "mixed-port:", "socks-port:", "---"} {
		if strings.HasPrefix(trimmed, prefix) {
			return true
		}
	}
	// A single proxy entry written as YAML.
	return strings.Contains(trimmed, "type:") && strings.Contains(trimmed, "server:")
}

// outboundFromClashYAML converts a Clash proxy entry into a sing-box outbound.
// Only the fields the app previously generated are translated; anything else is
// reported so the user can migrate the profile explicitly.
func outboundFromClashYAML(raw string) (Outbound, error) {
	var root any
	if err := yaml.Unmarshal([]byte(raw), &root); err != nil {
		return nil, fmt.Errorf("invalid Clash YAML: %w", err)
	}

	proxy, err := firstClashProxy(root)
	if err != nil {
		return nil, err
	}

	server := stringValue(proxy["server"])
	port := intValue(proxy["port"])
	if server == "" || port == 0 {
		return nil, fmt.Errorf("Clash proxy is missing server or port")
	}

	outbound := Outbound{"server": server, "server_port": port}

	switch strings.ToLower(stringValue(proxy["type"])) {
	case "vless":
		outbound["type"] = "vless"
		outbound["uuid"] = stringValue(proxy["uuid"])
		if flow := stringValue(proxy["flow"]); flow != "" && clashNetwork(proxy) == "" {
			outbound["flow"] = flow
		}
	case "vmess":
		outbound["type"] = "vmess"
		outbound["uuid"] = stringValue(proxy["uuid"])
		security := stringValue(proxy["cipher"])
		if security == "" {
			security = "auto"
		}
		outbound["security"] = security
		if alterID := intValue(proxy["alterId"]); alterID > 0 {
			outbound["alter_id"] = alterID
		}
	case "trojan":
		outbound["type"] = "trojan"
		outbound["password"] = stringValue(proxy["password"])
	case "ss", "shadowsocks":
		outbound["type"] = "shadowsocks"
		outbound["method"] = stringValue(proxy["cipher"])
		outbound["password"] = stringValue(proxy["password"])
	case "hysteria2":
		outbound["type"] = "hysteria2"
		outbound["password"] = stringValue(proxy["password"])
		if obfs := stringValue(proxy["obfs"]); obfs != "" && obfs != "none" {
			outbound["obfs"] = map[string]any{
				"type":     obfs,
				"password": stringValue(proxy["obfs-password"]),
			}
		}
	case "tuic":
		outbound["type"] = "tuic"
		outbound["uuid"] = stringValue(proxy["uuid"])
		outbound["password"] = stringValue(proxy["password"])
		if congestion := stringValue(proxy["congestion-controller"]); congestion != "" {
			outbound["congestion_control"] = congestion
		}
		if mode := stringValue(proxy["udp-relay-mode"]); mode != "" {
			outbound["udp_relay_mode"] = mode
		}
	case "socks5", "socks":
		outbound["type"] = "socks"
		outbound["version"] = "5"
		if username := stringValue(proxy["username"]); username != "" {
			outbound["username"] = username
			outbound["password"] = stringValue(proxy["password"])
		}
	case "http":
		outbound["type"] = "http"
		if username := stringValue(proxy["username"]); username != "" {
			outbound["username"] = username
			outbound["password"] = stringValue(proxy["password"])
		}
	case "ssh":
		outbound["type"] = "ssh"
		outbound["user"] = stringValue(proxy["username"])
		if password := stringValue(proxy["password"]); password != "" {
			outbound["password"] = password
		}
	default:
		return nil, fmt.Errorf(
			"Clash proxy type %q has no sing-box equivalent; re-import this profile as a share link or sing-box JSON",
			stringValue(proxy["type"]))
	}

	if tlsOpts := clashTLS(proxy, server); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}
	if transport := clashTransport(proxy, server); transport != nil {
		outbound["transport"] = transport
	}
	return outbound, nil
}

func firstClashProxy(root any) (map[string]any, error) {
	switch typed := root.(type) {
	case map[string]any:
		if proxies, ok := typed["proxies"].([]any); ok {
			for _, item := range proxies {
				if proxy, ok := item.(map[string]any); ok {
					return proxy, nil
				}
			}
			return nil, fmt.Errorf("Clash config has an empty proxies list")
		}
		if typed["type"] != nil && typed["server"] != nil {
			return typed, nil
		}
	}
	return nil, fmt.Errorf("no proxy entry found in Clash YAML")
}

func clashTLS(proxy map[string]any, server string) map[string]any {
	realityOpts, hasReality := proxy["reality-opts"].(map[string]any)
	tlsEnabled := boolValue(proxy["tls"]) || hasReality
	if strings.ToLower(stringValue(proxy["type"])) == "trojan" {
		tlsEnabled = true
	}
	if !tlsEnabled {
		return nil
	}

	serverName := stringValue(proxy["servername"])
	if serverName == "" {
		serverName = stringValue(proxy["sni"])
	}
	if serverName == "" {
		serverName = server
	}

	tlsOpts := map[string]any{"enabled": true, "server_name": serverName}
	if alpn, ok := proxy["alpn"].([]any); ok && len(alpn) > 0 {
		values := make([]string, 0, len(alpn))
		for _, item := range alpn {
			if value := strings.TrimSpace(stringValue(item)); value != "" {
				values = append(values, value)
			}
		}
		if len(values) > 0 {
			tlsOpts["alpn"] = values
		}
	}

	fingerprint := stringValue(proxy["client-fingerprint"])
	if hasReality {
		if fingerprint == "" {
			fingerprint = "chrome"
		}
		tlsOpts["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
		tlsOpts["reality"] = map[string]any{
			"enabled":    true,
			"public_key": stringValue(realityOpts["public-key"]),
			"short_id":   stringValue(realityOpts["short-id"]),
		}
		return tlsOpts
	}

	if fingerprint != "" {
		tlsOpts["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
	}
	if boolValue(proxy["skip-cert-verify"]) {
		tlsOpts["insecure"] = true
	}
	return tlsOpts
}

func clashNetwork(proxy map[string]any) string {
	return normalizeTransport(stringValue(proxy["network"]))
}

func clashTransport(proxy map[string]any, server string) map[string]any {
	switch clashNetwork(proxy) {
	case "ws":
		options, _ := proxy["ws-opts"].(map[string]any)
		path := stringValue(options["path"])
		if path == "" {
			path = "/"
		}
		hostHeader := server
		if headers, ok := options["headers"].(map[string]any); ok {
			if value := stringValue(headers["Host"]); value != "" {
				hostHeader = value
			}
		}
		transport := map[string]any{
			"type":    "ws",
			"path":    path,
			"headers": map[string]any{"Host": hostHeader},
		}
		if maxEarlyData := intValue(options["max-early-data"]); maxEarlyData > 0 {
			transport["max_early_data"] = maxEarlyData
			name := stringValue(options["early-data-header-name"])
			if name == "" {
				name = "Sec-WebSocket-Protocol"
			}
			transport["early_data_header_name"] = name
		}
		return transport

	case "grpc":
		options, _ := proxy["grpc-opts"].(map[string]any)
		return map[string]any{
			"type":         "grpc",
			"service_name": stringValue(options["grpc-service-name"]),
		}

	case "http":
		options, _ := proxy["h2-opts"].(map[string]any)
		path := stringValue(options["path"])
		if path == "" {
			path = "/"
		}
		hosts := []string{server}
		if raw, ok := options["host"].([]any); ok && len(raw) > 0 {
			hosts = hosts[:0]
			for _, item := range raw {
				if value := strings.TrimSpace(stringValue(item)); value != "" {
					hosts = append(hosts, value)
				}
			}
		}
		return map[string]any{"type": "http", "host": hosts, "path": path}
	}
	return nil
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		}
	}
	return false
}
