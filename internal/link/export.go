package link

import (
	"encoding/json"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// ExportFormats recognized by Export.
const (
	FormatSingBox = "singbox"
	FormatClash   = "clash"
	FormatXray    = "xray"
)

// NormalizeFormat cleans up user/caller format names.
func NormalizeFormat(format string) string {
	f := strings.ToLower(strings.TrimSpace(format))
	switch f {
	case "sing-box", "singbox", "sb":
		return FormatSingBox
	case "clash", "clash-meta", "mihomo", "yaml":
		return FormatClash
	case "xray", "v2ray", "xray-core":
		return FormatXray
	default:
		return FormatSingBox
	}
}

// Export turns saved profiles into a configuration string formatted for sing-box, Clash, or Xray.
// If full is true, a complete working client configuration (with inbounds, DNS, and route rules)
// is generated; otherwise, only the proxy/outbound objects are produced.
func Export(profiles []models.Profile, settings models.AppSettings, format string, full bool) (string, error) {
	if len(profiles) == 0 {
		return "", fmt.Errorf("no profiles to export")
	}

	outbounds := make([]Outbound, 0, len(profiles))
	usedTags := make(map[string]int)

	for _, p := range profiles {
		obs, err := profileToOutbounds(p, settings)
		if err != nil {
			continue
		}
		for _, ob := range obs {
			tag := strings.TrimSpace(stringValue(ob["tag"]))
			if tag == "" {
				tag = strings.TrimSpace(p.Name)
			}
			if tag == "" {
				tag = "proxy"
			}
			// Deduplicate tags
			count := usedTags[tag]
			usedTags[tag]++
			if count > 0 {
				tag = fmt.Sprintf("%s (%d)", tag, count+1)
			}
			ob["tag"] = tag
			outbounds = append(outbounds, ob)
		}
	}

	if len(outbounds) == 0 {
		return "", fmt.Errorf("no valid proxy configurations found to export")
	}

	norm := NormalizeFormat(format)
	switch norm {
	case FormatSingBox:
		return exportSingBox(outbounds, full)
	case FormatClash:
		return exportClash(outbounds, full)
	case FormatXray:
		return exportXray(outbounds, full)
	default:
		return "", fmt.Errorf("unsupported export format: %s", format)
	}
}

// profileToOutbounds extracts one or more dialable Outbound objects from a profile.
func profileToOutbounds(profile models.Profile, settings models.AppSettings) ([]Outbound, error) {
	trimmed := strings.TrimSpace(profile.ConfigLink)
	if trimmed == "" {
		return nil, fmt.Errorf("empty config link")
	}

	// Full JSON document check (e.g. pasted multi-outbound sing-box or xray config)
	if strings.HasPrefix(trimmed, "{") {
		var root map[string]any
		if err := json.Unmarshal([]byte(trimmed), &root); err == nil {
			servers := configServers(root)
			if len(servers) > 0 {
				obs := make([]Outbound, 0, len(servers))
				for _, s := range servers {
					obs = append(obs, Outbound(s))
				}
				return obs, nil
			}
		}
	}

	// Normal single outbound link / share URI
	ob, err := ParseOutbound(trimmed, settings)
	if err != nil {
		return nil, err
	}
	if name := strings.TrimSpace(profile.Name); name != "" {
		ob["tag"] = name
	}
	return []Outbound{ob}, nil
}

// ---------------------------------------------------------------------------
// Sing-box Exporter
// ---------------------------------------------------------------------------

func exportSingBox(outbounds []Outbound, full bool) (string, error) {
	if !full {
		raw := map[string]any{
			"outbounds": outbounds,
		}
		bytes, err := json.MarshalIndent(raw, "", "  ")
		if err != nil {
			return "", err
		}
		return string(bytes), nil
	}

	tags := make([]string, 0, len(outbounds))
	allOutbounds := make([]any, 0, len(outbounds)+3)

	for _, ob := range outbounds {
		tag := stringValue(ob["tag"])
		tags = append(tags, tag)
		allOutbounds = append(allOutbounds, ob)
	}

	// Add selector outbound for convenient node switching
	selector := map[string]any{
		"type":      "selector",
		"tag":       "select",
		"outbounds": tags,
		"default":   tags[0],
	}

	allOutbounds = append(allOutbounds,
		selector,
		map[string]any{"type": "direct", "tag": "direct"},
		map[string]any{"type": "block", "tag": "block"},
	)

	doc := map[string]any{
		"log": map[string]any{
			"level": "info",
		},
		"inbounds": []any{
			map[string]any{
				"type":        "mixed",
				"tag":         "mixed-in",
				"listen":      "127.0.0.1",
				"listen_port": 2080,
			},
		},
		"outbounds": allOutbounds,
		"route": map[string]any{
			"rules": []any{
				map[string]any{
					"action": "sniff",
				},
				map[string]any{
					"protocol": "dns",
					"action":   "hijack-dns",
				},
			},
			"auto_detect_interface": true,
			"final":                 "select",
		},
	}

	bytes, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// ---------------------------------------------------------------------------
// Clash / Mihomo Exporter
// ---------------------------------------------------------------------------

func exportClash(outbounds []Outbound, full bool) (string, error) {
	proxies := make([]map[string]any, 0, len(outbounds))
	names := make([]string, 0, len(outbounds))

	for _, ob := range outbounds {
		p, err := outboundToClash(ob)
		if err != nil {
			continue
		}
		name := stringValue(p["name"])
		if name == "" {
			name = stringValue(ob["tag"])
			p["name"] = name
		}
		proxies = append(proxies, p)
		names = append(names, name)
	}

	if len(proxies) == 0 {
		return "", fmt.Errorf("no proxies could be converted to Clash format")
	}

	if !full {
		raw := map[string]any{
			"proxies": proxies,
		}
		bytes, err := yaml.Marshal(raw)
		if err != nil {
			return "", err
		}
		return string(bytes), nil
	}

	doc := map[string]any{
		"port":               7890,
		"socks-port":         7891,
		"mixed-port":         7892,
		"allow-lan":          false,
		"mode":               "rule",
		"log-level":          "info",
		"ipv6":               false,
		"external-controller": "127.0.0.1:9090",
		"proxies":            proxies,
		"proxy-groups": []any{
			map[string]any{
				"name":    "PROXY",
				"type":    "select",
				"proxies": append(append([]string{}, names...), "DIRECT"),
			},
			map[string]any{
				"name":     "AUTO",
				"type":     "url-test",
				"url":      "http://www.gstatic.com/generate_204",
				"interval": 300,
				"proxies":  names,
			},
		},
		"rules": []any{
			"MATCH,PROXY",
		},
	}

	bytes, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func outboundToClash(ob Outbound) (map[string]any, error) {
	kind := stringValue(ob["type"])
	server := stringValue(ob["server"])
	port := intValue(ob["server_port"])
	tag := stringValue(ob["tag"])

	if server == "" || port == 0 {
		return nil, fmt.Errorf("outbound missing server or port")
	}

	proxy := map[string]any{
		"name":   tag,
		"server": server,
		"port":   port,
	}

	switch kind {
	case "vless":
		proxy["type"] = "vless"
		proxy["uuid"] = stringValue(ob["uuid"])
		proxy["udp"] = true
		if flow := stringValue(ob["flow"]); flow != "" {
			proxy["flow"] = flow
		}
		applyClashTLS(proxy, ob, server)
		applyClashTransport(proxy, ob, server)

	case "vmess":
		proxy["type"] = "vmess"
		proxy["uuid"] = stringValue(ob["uuid"])
		proxy["alterId"] = defaultInt(intValue(ob["alter_id"]), 0)
		proxy["cipher"] = defaultString(stringValue(ob["security"]), "auto")
		proxy["udp"] = true
		applyClashTLS(proxy, ob, server)
		applyClashTransport(proxy, ob, server)

	case "trojan":
		proxy["type"] = "trojan"
		proxy["password"] = stringValue(ob["password"])
		proxy["udp"] = true
		applyClashTLS(proxy, ob, server)
		applyClashTransport(proxy, ob, server)

	case "shadowsocks":
		proxy["type"] = "ss"
		proxy["cipher"] = stringValue(ob["method"])
		proxy["password"] = stringValue(ob["password"])
		proxy["udp"] = true
		if plugin := stringValue(ob["plugin"]); plugin != "" {
			proxy["plugin"] = plugin
			if opts := stringValue(ob["plugin_opts"]); opts != "" {
				proxy["plugin-opts"] = parseClashPluginOpts(opts)
			}
		}

	case "hysteria2":
		proxy["type"] = "hysteria2"
		proxy["password"] = stringValue(ob["password"])
		proxy["sni"] = server
		if tls, ok := ob["tls"].(map[string]any); ok {
			if sni := stringValue(tls["server_name"]); sni != "" {
				proxy["sni"] = sni
			}
			if tls["insecure"] == true {
				proxy["skip-cert-verify"] = true
			}
			if alpn := stringList(tls["alpn"]); len(alpn) > 0 {
				proxy["alpn"] = alpn
			}
		}
		if obfs, ok := ob["obfs"].(map[string]any); ok && stringValue(obfs["type"]) != "" {
			proxy["obfs"] = stringValue(obfs["type"])
			proxy["obfs-password"] = stringValue(obfs["password"])
		}
		if up := intValue(ob["up_mbps"]); up > 0 {
			proxy["up"] = fmt.Sprintf("%d Mbps", up)
		}
		if down := intValue(ob["down_mbps"]); down > 0 {
			proxy["down"] = fmt.Sprintf("%d Mbps", down)
		}

	case "tuic":
		proxy["type"] = "tuic"
		proxy["uuid"] = stringValue(ob["uuid"])
		proxy["password"] = stringValue(ob["password"])
		proxy["congestion-controller"] = defaultString(stringValue(ob["congestion_control"]), "bbr")
		proxy["udp-relay-mode"] = defaultString(stringValue(ob["udp_relay_mode"]), "native")
		if tls, ok := ob["tls"].(map[string]any); ok {
			if sni := stringValue(tls["server_name"]); sni != "" {
				proxy["sni"] = sni
			}
			if tls["insecure"] == true {
				proxy["skip-cert-verify"] = true
			}
		}

	case "socks":
		proxy["type"] = "socks5"
		if user := stringValue(ob["username"]); user != "" {
			proxy["username"] = user
			proxy["password"] = stringValue(ob["password"])
		}

	case "http":
		proxy["type"] = "http"
		if user := stringValue(ob["username"]); user != "" {
			proxy["username"] = user
			proxy["password"] = stringValue(ob["password"])
		}
		if tls, ok := ob["tls"].(map[string]any); ok && tls["enabled"] != false {
			proxy["tls"] = true
		}

	case "wireguard":
		proxy["type"] = "wireguard"
		proxy["ip"] = stringValue(ob["local_address"])
		proxy["public-key"] = stringValue(ob["peer_public_key"])
		proxy["private-key"] = stringValue(ob["private_key"])
		if pre := stringValue(ob["pre_shared_key"]); pre != "" {
			proxy["preshared-key"] = pre
		}

	default:
		return nil, fmt.Errorf("protocol %q cannot be exported to Clash", kind)
	}

	return proxy, nil
}

func applyClashTLS(proxy map[string]any, ob Outbound, server string) {
	tls, _ := ob["tls"].(map[string]any)
	if tls == nil || tls["enabled"] == false {
		return
	}
	proxy["tls"] = true

	sni := stringValue(tls["server_name"])
	if sni == "" {
		sni = server
	}
	proxy["servername"] = sni

	if tls["insecure"] == true {
		proxy["skip-cert-verify"] = true
	}
	if alpn := stringList(tls["alpn"]); len(alpn) > 0 {
		proxy["alpn"] = alpn
	}

	if reality, ok := tls["reality"].(map[string]any); ok && reality["enabled"] != false {
		proxy["reality-opts"] = map[string]any{
			"public-key": stringValue(reality["public_key"]),
			"short-id":   stringValue(reality["short_id"]),
		}
	}

	if utls, ok := tls["utls"].(map[string]any); ok {
		if fp := stringValue(utls["fingerprint"]); fp != "" {
			proxy["client-fingerprint"] = fp
		}
	}
}

func applyClashTransport(proxy map[string]any, ob Outbound, server string) {
	transport, _ := ob["transport"].(map[string]any)
	if transport == nil {
		return
	}
	switch stringValue(transport["type"]) {
	case "ws":
		proxy["network"] = "ws"
		path := defaultString(stringValue(transport["path"]), "/")
		wsOpts := map[string]any{"path": path}
		if headers, ok := transport["headers"].(map[string]any); ok {
			if host := stringValue(headers["Host"]); host != "" {
				wsOpts["headers"] = map[string]any{"Host": host}
			}
		}
		proxy["ws-opts"] = wsOpts

	case "grpc":
		proxy["network"] = "grpc"
		proxy["grpc-opts"] = map[string]any{
			"grpc-service-name": stringValue(transport["service_name"]),
		}

	case "http":
		proxy["network"] = "h2"
		h2Opts := map[string]any{"path": defaultString(stringValue(transport["path"]), "/")}
		if host := stringList(transport["host"]); len(host) > 0 {
			h2Opts["host"] = host
		}
		proxy["h2-opts"] = h2Opts

	case "httpupgrade":
		proxy["network"] = "httpupgrade"
		proxy["httpupgrade-opts"] = map[string]any{
			"path": defaultString(stringValue(transport["path"]), "/"),
			"host": stringValue(transport["host"]),
		}
	}
}

func parseClashPluginOpts(raw string) map[string]any {
	opts := make(map[string]any)
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		k, v, found := strings.Cut(part, "=")
		if found {
			opts[k] = v
		} else {
			opts[part] = true
		}
	}
	return opts
}

// ---------------------------------------------------------------------------
// Xray Exporter
// ---------------------------------------------------------------------------

func exportXray(outbounds []Outbound, full bool) (string, error) {
	xrayOutbounds := make([]map[string]any, 0, len(outbounds))
	tags := make([]string, 0, len(outbounds))

	for _, ob := range outbounds {
		xo, err := outboundToXray(ob)
		if err != nil {
			continue
		}
		xrayOutbounds = append(xrayOutbounds, xo)
		tags = append(tags, stringValue(xo["tag"]))
	}

	if len(xrayOutbounds) == 0 {
		return "", fmt.Errorf("no proxies could be converted to Xray format")
	}

	if !full {
		raw := map[string]any{
			"outbounds": xrayOutbounds,
		}
		bytes, err := json.MarshalIndent(raw, "", "  ")
		if err != nil {
			return "", err
		}
		return string(bytes), nil
	}

	allOutbounds := make([]any, 0, len(xrayOutbounds)+2)
	for _, xo := range xrayOutbounds {
		allOutbounds = append(allOutbounds, xo)
	}
	allOutbounds = append(allOutbounds,
		map[string]any{
			"protocol": "freedom",
			"tag":      "direct",
		},
		map[string]any{
			"protocol": "blackhole",
			"tag":      "block",
		},
	)

	doc := map[string]any{
		"log": map[string]any{
			"loglevel": "warning",
		},
		"inbounds": []any{
			map[string]any{
				"tag":      "socks-in",
				"port":     10808,
				"listen":   "127.0.0.1",
				"protocol": "socks",
				"settings": map[string]any{
					"auth": "noauth",
					"udp":  true,
				},
			},
			map[string]any{
				"tag":      "http-in",
				"port":     10809,
				"listen":   "127.0.0.1",
				"protocol": "http",
			},
		},
		"outbounds": allOutbounds,
		"routing": map[string]any{
			"domainStrategy": "AsIs",
			"rules": []any{
				map[string]any{
					"type":        "field",
					"inboundTag":  []string{"socks-in", "http-in"},
					"outboundTag": tags[0],
				},
			},
		},
	}

	bytes, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func outboundToXray(ob Outbound) (map[string]any, error) {
	kind := stringValue(ob["type"])
	server := stringValue(ob["server"])
	port := intValue(ob["server_port"])
	tag := stringValue(ob["tag"])

	if server == "" || port == 0 {
		return nil, fmt.Errorf("outbound missing server or port")
	}

	xo := map[string]any{
		"tag": tag,
	}

	switch kind {
	case "vless":
		xo["protocol"] = "vless"
		user := map[string]any{
			"id":         stringValue(ob["uuid"]),
			"encryption": defaultString(stringValue(ob["encryption"]), "none"),
		}
		if flow := stringValue(ob["flow"]); flow != "" {
			user["flow"] = flow
		}
		xo["settings"] = map[string]any{
			"vnext": []any{
				map[string]any{
					"address": server,
					"port":    port,
					"users":   []any{user},
				},
			},
		}
		applyXrayStream(xo, ob, server)

	case "vmess":
		xo["protocol"] = "vmess"
		user := map[string]any{
			"id":       stringValue(ob["uuid"]),
			"alterId":  defaultInt(intValue(ob["alter_id"]), 0),
			"security": defaultString(stringValue(ob["security"]), "auto"),
		}
		xo["settings"] = map[string]any{
			"vnext": []any{
				map[string]any{
					"address": server,
					"port":    port,
					"users":   []any{user},
				},
			},
		}
		applyXrayStream(xo, ob, server)

	case "trojan":
		xo["protocol"] = "trojan"
		xo["settings"] = map[string]any{
			"servers": []any{
				map[string]any{
					"address":  server,
					"port":     port,
					"password": stringValue(ob["password"]),
				},
			},
		}
		applyXrayStream(xo, ob, server)

	case "shadowsocks":
		xo["protocol"] = "shadowsocks"
		xo["settings"] = map[string]any{
			"servers": []any{
				map[string]any{
					"address":  server,
					"port":     port,
					"method":   stringValue(ob["method"]),
					"password": stringValue(ob["password"]),
				},
			},
		}

	case "socks":
		xo["protocol"] = "socks"
		serverEntry := map[string]any{
			"address": server,
			"port":    port,
		}
		if user := stringValue(ob["username"]); user != "" {
			serverEntry["users"] = []any{
				map[string]any{
					"user": user,
					"pass": stringValue(ob["password"]),
				},
			}
		}
		xo["settings"] = map[string]any{
			"servers": []any{serverEntry},
		}

	case "http":
		xo["protocol"] = "http"
		serverEntry := map[string]any{
			"address": server,
			"port":    port,
		}
		if user := stringValue(ob["username"]); user != "" {
			serverEntry["users"] = []any{
				map[string]any{
					"user": user,
					"pass": stringValue(ob["password"]),
				},
			}
		}
		xo["settings"] = map[string]any{
			"servers": []any{serverEntry},
		}
		if tls, ok := ob["tls"].(map[string]any); ok && tls["enabled"] != false {
			applyXrayStream(xo, ob, server)
		}

	default:
		return nil, fmt.Errorf("protocol %q is not natively supported as Xray outbound", kind)
	}

	return xo, nil
}

func applyXrayStream(xo map[string]any, ob Outbound, server string) {
	stream := map[string]any{
		"network": "tcp",
	}

	transport, _ := ob["transport"].(map[string]any)
	if transport != nil {
		switch stringValue(transport["type"]) {
		case "ws":
			stream["network"] = "ws"
			wsSettings := map[string]any{
				"path": defaultString(stringValue(transport["path"]), "/"),
			}
			if headers, ok := transport["headers"].(map[string]any); ok {
				if host := stringValue(headers["Host"]); host != "" {
					wsSettings["headers"] = map[string]any{"Host": host}
				}
			}
			stream["wsSettings"] = wsSettings

		case "grpc":
			stream["network"] = "grpc"
			stream["grpcSettings"] = map[string]any{
				"serviceName": stringValue(transport["service_name"]),
			}

		case "http":
			stream["network"] = "http"
			h2Settings := map[string]any{
				"path": defaultString(stringValue(transport["path"]), "/"),
			}
			if host := stringList(transport["host"]); len(host) > 0 {
				h2Settings["host"] = host
			}
			stream["httpSettings"] = h2Settings

		case "httpupgrade":
			stream["network"] = "httpupgrade"
			stream["httpupgradeSettings"] = map[string]any{
				"path": defaultString(stringValue(transport["path"]), "/"),
				"host": stringValue(transport["host"]),
			}

		case "xhttp":
			stream["network"] = "xhttp"
			xhttp := map[string]any{
				"path": defaultString(stringValue(transport["path"]), "/"),
				"host": stringValue(transport["host"]),
			}
			if mode := stringValue(transport["mode"]); mode != "" {
				xhttp["mode"] = mode
			}
			stream["xhttpSettings"] = xhttp
		}
	}

	tls, _ := ob["tls"].(map[string]any)
	if tls != nil && tls["enabled"] != false {
		sni := stringValue(tls["server_name"])
		if sni == "" {
			sni = server
		}

		if reality, ok := tls["reality"].(map[string]any); ok && reality["enabled"] != false {
			stream["security"] = "reality"
			realitySettings := map[string]any{
				"serverName": sni,
				"publicKey":  stringValue(reality["public_key"]),
				"shortId":    stringValue(reality["short_id"]),
			}
			if utls, ok := tls["utls"].(map[string]any); ok {
				realitySettings["fingerprint"] = stringValue(utls["fingerprint"])
			}
			stream["realitySettings"] = realitySettings
		} else {
			stream["security"] = "tls"
			tlsSettings := map[string]any{
				"serverName": sni,
			}
			if tls["insecure"] == true {
				tlsSettings["allowInsecure"] = true
			}
			if alpn := stringList(tls["alpn"]); len(alpn) > 0 {
				tlsSettings["alpn"] = alpn
			}
			if utls, ok := tls["utls"].(map[string]any); ok {
				tlsSettings["fingerprint"] = stringValue(utls["fingerprint"])
			}
			stream["tlsSettings"] = tlsSettings
		}
	}

	xo["streamSettings"] = stream
}
