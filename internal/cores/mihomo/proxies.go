package mihomo

import (
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
)

// proxyFrom converts a built-in outbound into a mihomo proxy entry.
func proxyFrom(name string, source link.Outbound) (map[string]any, error) {
	server, port := str(source["server"]), num(source["server_port"])
	proxy := map[string]any{"name": name, "server": server, "port": port, "udp": true}

	switch str(source["type"]) {
	case "vless":
		proxy["type"] = "vless"
		proxy["uuid"] = str(source["uuid"])
		if flow := str(source["flow"]); flow != "" {
			proxy["flow"] = flow
		}
		proxy["packet-encoding"] = "xudp"
		if err := applyTransport(proxy, source); err != nil {
			return nil, err
		}
		applyTLS(proxy, source, "servername")

	case "vmess":
		proxy["type"] = "vmess"
		proxy["uuid"] = str(source["uuid"])
		proxy["alterId"] = num(source["alter_id"])
		cipher := str(source["security"])
		if cipher == "" {
			cipher = "auto"
		}
		proxy["cipher"] = cipher
		if err := applyTransport(proxy, source); err != nil {
			return nil, err
		}
		applyTLS(proxy, source, "servername")

	case "trojan":
		proxy["type"] = "trojan"
		proxy["password"] = str(source["password"])
		if err := applyTransport(proxy, source); err != nil {
			return nil, err
		}
		applyTLS(proxy, source, "sni")
		// Trojan is always TLS; the flag is implied.
		delete(proxy, "tls")

	case "shadowsocks":
		proxy["type"] = "ss"
		proxy["cipher"] = str(source["method"])
		proxy["password"] = str(source["password"])
		if plugin := str(source["plugin"]); plugin != "" {
			options := pluginOptions(str(source["plugin_opts"]))
			switch plugin {
			case "obfs-local":
				proxy["plugin"] = "obfs"
				proxy["plugin-opts"] = map[string]any{"mode": firstOf(options["obfs"], "http"), "host": options["obfs-host"]}
			case "v2ray-plugin":
				opts := map[string]any{"mode": firstOf(options["mode"], "websocket"), "host": options["host"], "path": firstOf(options["path"], "/")}
				if _, tls := options["tls"]; tls {
					opts["tls"] = true
				}
				proxy["plugin"] = "v2ray-plugin"
				proxy["plugin-opts"] = opts
			default:
				return nil, fmt.Errorf("mihomo cannot use the Shadowsocks plugin %q", plugin)
			}
		}

	case "hysteria2":
		proxy["type"] = "hysteria2"
		proxy["password"] = str(source["password"])
		if obfs, _ := source["obfs"].(map[string]any); obfs != nil {
			proxy["obfs"] = str(obfs["type"])
			proxy["obfs-password"] = str(obfs["password"])
		}
		if up := num(source["up_mbps"]); up > 0 {
			proxy["up"] = strconv.Itoa(up) + " Mbps"
		}
		if down := num(source["down_mbps"]); down > 0 {
			proxy["down"] = strconv.Itoa(down) + " Mbps"
		}
		applyTLS(proxy, source, "sni")
		delete(proxy, "tls")

	case "hysteria":
		proxy["type"] = "hysteria"
		proxy["auth-str"] = str(source["auth_str"])
		proxy["up"] = strconv.Itoa(num(source["up_mbps"]))
		proxy["down"] = strconv.Itoa(num(source["down_mbps"]))
		if obfs := str(source["obfs"]); obfs != "" {
			proxy["obfs"] = obfs
		}
		applyTLS(proxy, source, "sni")
		delete(proxy, "tls")

	case "tuic":
		proxy["type"] = "tuic"
		proxy["uuid"] = str(source["uuid"])
		proxy["password"] = str(source["password"])
		proxy["congestion-controller"] = firstOf(str(source["congestion_control"]), "bbr")
		proxy["udp-relay-mode"] = firstOf(str(source["udp_relay_mode"]), "native")
		if source["zero_rtt_handshake"] == true {
			proxy["reduce-rtt"] = true
		}
		applyTLS(proxy, source, "sni")
		delete(proxy, "tls")

	case "wireguard":
		proxy["type"] = "wireguard"
		proxy["private-key"] = str(source["private_key"])
		for _, address := range texts(source["address"]) {
			ip, _, _ := strings.Cut(address, "/")
			if strings.Contains(ip, ":") {
				proxy["ipv6"] = ip
			} else if proxy["ip"] == nil {
				proxy["ip"] = ip
			}
		}
		peers := list(source["peers"])
		if len(peers) == 0 {
			return nil, fmt.Errorf("the WireGuard server has no peer")
		}
		peer := peers[0]
		proxy["server"], proxy["port"] = str(peer["address"]), num(peer["port"])
		proxy["public-key"] = str(peer["public_key"])
		if key := str(peer["pre_shared_key"]); key != "" {
			proxy["pre-shared-key"] = key
		}
		if ips := texts(peer["allowed_ips"]); len(ips) > 0 {
			proxy["allowed-ips"] = ips
		}
		if reserved, ok := peer["reserved"].([]int); ok && len(reserved) == 3 {
			proxy["reserved"] = reserved
		}
		if mtu := num(source["mtu"]); mtu > 0 {
			proxy["mtu"] = mtu
		}

	case "socks":
		proxy["type"] = "socks5"
		copyCredentials(proxy, source, "username")
		if tls, _ := source["tls"].(map[string]any); tls != nil && tls["enabled"] == true {
			proxy["tls"] = true
			if tls["insecure"] == true {
				proxy["skip-cert-verify"] = true
			}
		}

	case "http":
		proxy["type"] = "http"
		copyCredentials(proxy, source, "username")
		applyTLS(proxy, source, "sni")

	case "ssh":
		proxy["type"] = "ssh"
		proxy["username"] = str(source["user"])
		if password := str(source["password"]); password != "" {
			proxy["password"] = password
		}
		if key := str(source["private_key"]); key != "" {
			proxy["private-key"] = key
		}
		if passphrase := str(source["private_key_passphrase"]); passphrase != "" {
			proxy["private-key-passphrase"] = passphrase
		}
		if keys := texts(source["host_key"]); len(keys) > 0 {
			proxy["host-key"] = keys
		}

	default:
		return nil, fmt.Errorf("mihomo cannot connect to %s servers; use the built-in core for this one", str(source["type"]))
	}
	return proxy, nil
}

// applyTLS copies the TLS block onto a proxy; nameKey is the field the
// protocol keeps the server name in.
func applyTLS(proxy map[string]any, source link.Outbound, nameKey string) {
	tls, _ := source["tls"].(map[string]any)
	if tls == nil || tls["enabled"] != true {
		return
	}
	proxy["tls"] = true
	if name := str(tls["server_name"]); name != "" {
		proxy[nameKey] = name
	}
	if alpn := texts(tls["alpn"]); len(alpn) > 0 {
		proxy["alpn"] = alpn
	}
	if tls["insecure"] == true {
		proxy["skip-cert-verify"] = true
	}
	if utls, _ := tls["utls"].(map[string]any); utls != nil {
		if fingerprint := str(utls["fingerprint"]); fingerprint != "" {
			proxy["client-fingerprint"] = fingerprint
		}
	}
	if reality, _ := tls["reality"].(map[string]any); reality != nil && reality["enabled"] == true {
		proxy["reality-opts"] = map[string]any{"public-key": str(reality["public_key"]), "short-id": str(reality["short_id"])}
		if proxy["client-fingerprint"] == nil {
			proxy["client-fingerprint"] = "chrome"
		}
	}
}

// applyTransport maps the built-in transports onto mihomo's networks.
func applyTransport(proxy map[string]any, source link.Outbound) error {
	transport, _ := source["transport"].(map[string]any)
	if transport == nil {
		return nil
	}
	switch str(transport["type"]) {
	case "ws":
		options := map[string]any{"path": str(transport["path"])}
		if headers, _ := transport["headers"].(map[string]any); headers != nil && str(headers["Host"]) != "" {
			options["headers"] = map[string]any{"Host": str(headers["Host"])}
		}
		if early := num(transport["max_early_data"]); early > 0 {
			options["max-early-data"] = early
			options["early-data-header-name"] = firstOf(str(transport["early_data_header_name"]), "Sec-WebSocket-Protocol")
		}
		proxy["network"], proxy["ws-opts"] = "ws", options
	case "httpupgrade":
		options := map[string]any{"path": str(transport["path"]), "v2ray-http-upgrade": true}
		if host := str(transport["host"]); host != "" {
			options["headers"] = map[string]any{"Host": host}
		}
		proxy["network"], proxy["ws-opts"] = "ws", options
	case "grpc":
		proxy["network"], proxy["grpc-opts"] = "grpc", map[string]any{"grpc-service-name": str(transport["service_name"])}
	case "http":
		proxy["network"], proxy["h2-opts"] = "h2", map[string]any{"host": texts(transport["host"]), "path": str(transport["path"])}
	case "xhttp":
		options := map[string]any{"path": str(transport["path"])}
		if host := str(transport["host"]); host != "" {
			options["host"] = host
		}
		if mode := str(transport["mode"]); mode != "" {
			options["mode"] = mode
		}
		proxy["network"], proxy["xhttp-opts"] = "xhttp", options
	case "quic":
		return fmt.Errorf("mihomo has no QUIC transport for this server")
	}
	return nil
}

func copyCredentials(proxy map[string]any, source link.Outbound, key string) {
	if user := str(source[key]); user != "" {
		proxy["username"] = user
		proxy["password"] = str(source["password"])
	}
}

// pluginOptions reads "key=value;key;key=value".
func pluginOptions(raw string) map[string]string {
	result := map[string]string{}
	for _, part := range strings.Split(raw, ";") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		if key != "" {
			result[key] = value
		}
	}
	return result
}

func firstOf(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func str(value any) string {
	text, _ := value.(string)
	return text
}

func num(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case uint16:
		return int(number)
	case float64:
		return int(number)
	case string:
		parsed, _ := strconv.Atoi(number)
		return parsed
	}
	return 0
}

func texts(value any) []string {
	switch items := value.(type) {
	case []string:
		return items
	case []any:
		result := make([]string, 0, len(items))
		for _, item := range items {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
		return result
	case string:
		if items != "" {
			return []string{items}
		}
	}
	return nil
}

func list(value any) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if entry, ok := item.(map[string]any); ok {
				result = append(result, entry)
			}
		}
		return result
	}
	return nil
}

func isIP(value string) bool {
	return net.ParseIP(value) != nil
}
