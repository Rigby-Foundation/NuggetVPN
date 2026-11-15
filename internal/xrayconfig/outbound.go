// Package xrayconfig builds native Xray configurations from saved profiles.
package xrayconfig

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
	"github.com/xtls/xray-core/infra/conf"
)

func convert(source link.Outbound) (map[string]any, error) {
	server, port := str(source["server"]), num(source["server_port"])
	switch str(source["type"]) {
	case "vless":
		user := map[string]any{"id": str(source["uuid"]), "encryption": "none"}
		if encryption := str(source["encryption"]); encryption != "" {
			user["encryption"] = encryption
		}
		if flow := str(source["flow"]); flow != "" {
			user["flow"] = flow
		}
		stream, err := streamSettings(source)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"protocol":       "vless",
			"settings":       map[string]any{"vnext": []any{map[string]any{"address": server, "port": port, "users": []any{user}}}},
			"streamSettings": stream,
		}, nil

	case "vmess":
		if num(source["alter_id"]) != 0 {
			return nil, fmt.Errorf("Xray only supports VMess AEAD (alterId must be 0)")
		}
		security := str(source["security"])
		if security == "" {
			security = "auto"
		}
		stream, err := streamSettings(source)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"protocol": "vmess",
			"settings": map[string]any{"vnext": []any{map[string]any{"address": server, "port": port, "users": []any{
				map[string]any{"id": str(source["uuid"]), "security": security},
			}}}},
			"streamSettings": stream,
		}, nil

	case "trojan":
		stream, err := streamSettings(source)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"protocol":       "trojan",
			"settings":       map[string]any{"servers": []any{map[string]any{"address": server, "port": port, "password": str(source["password"])}}},
			"streamSettings": stream,
		}, nil

	case "shadowsocks":
		if str(source["plugin"]) != "" {
			return nil, fmt.Errorf("Xray cannot use Shadowsocks plugins (%s)", str(source["plugin"]))
		}
		return map[string]any{
			"protocol": "shadowsocks",
			"settings": map[string]any{"servers": []any{map[string]any{
				"address": server, "port": port, "method": str(source["method"]), "password": str(source["password"]),
			}}},
		}, nil

	case "hysteria2":
		stream, err := streamSettings(source)
		if err != nil {
			return nil, err
		}
		if stream["security"] != "tls" {
			return nil, fmt.Errorf("Hysteria 2 requires TLS")
		}
		stream["network"] = "hysteria"
		stream["hysteriaSettings"] = map[string]any{"version": 2, "auth": str(source["password"])}
		mask := map[string]any{}
		var udp []any
		if obfs, _ := source["obfs"].(map[string]any); obfs != nil && str(obfs["type"]) != "" {
			if str(obfs["type"]) != "salamander" {
				return nil, fmt.Errorf("Xray does not support Hysteria 2 obfuscation %q", str(obfs["type"]))
			}
			udp = append(udp, map[string]any{"type": "salamander", "settings": map[string]any{"password": str(obfs["password"])}})
		}
		if ports := texts(source["server_ports"]); len(ports) > 0 {
			udp = append(udp, map[string]any{"type": "udphop", "settings": map[string]any{"mode": "intervalremote", "remotePorts": strings.Join(ports, ",")}})
		}
		if len(udp) > 0 {
			mask["udp"] = udp
		}
		if up, down := num(source["up_mbps"]), num(source["down_mbps"]); up > 0 || down > 0 {
			quic := map[string]any{"congestion": "brutal"}
			if up > 0 {
				quic["brutalUp"] = strconv.Itoa(up) + "mbps"
			}
			if down > 0 {
				quic["brutalDown"] = strconv.Itoa(down) + "mbps"
			}
			mask["quicParams"] = quic
		}
		if len(mask) > 0 {
			stream["finalmask"] = mask
		}
		return map[string]any{
			"protocol": "hysteria", "settings": map[string]any{"version": 2, "address": server, "port": port}, "streamSettings": stream,
		}, nil

	case "socks", "http":
		if str(source["type"]) == "socks" && str(source["version"]) != "" && str(source["version"]) != "5" {
			return nil, fmt.Errorf("Xray only supports SOCKS5 outbounds")
		}
		entry := map[string]any{"address": server, "port": port}
		if user := str(source["username"]); user != "" {
			entry["users"] = []any{map[string]any{"user": user, "pass": str(source["password"])}}
		}
		result := map[string]any{"protocol": str(source["type"]), "settings": map[string]any{"servers": []any{entry}}}
		if tls, _ := source["tls"].(map[string]any); tls != nil && tls["enabled"] == true {
			stream, err := streamSettings(source)
			if err != nil {
				return nil, err
			}
			result["streamSettings"] = stream
		}
		return result, nil

	case "wireguard":
		peers := []any{}
		for _, peer := range list(source["peers"]) {
			entry := map[string]any{
				"publicKey": str(peer["public_key"]),
				"endpoint":  net.JoinHostPort(str(peer["address"]), strconv.Itoa(num(peer["port"]))),
			}
			if key := str(peer["pre_shared_key"]); key != "" {
				entry["preSharedKey"] = key
			}
			if keepalive := num(peer["persistent_keepalive_interval"]); keepalive > 0 {
				entry["keepAlive"] = keepalive
			}
			if ips := texts(peer["allowed_ips"]); len(ips) > 0 {
				entry["allowedIPs"] = ips
			}
			peers = append(peers, entry)
		}
		settings := map[string]any{
			"secretKey": str(source["private_key"]),
			"address":   texts(source["address"]),
			"peers":     peers,
		}
		if mtu := num(source["mtu"]); mtu > 0 {
			settings["mtu"] = mtu
		}
		for _, peer := range list(source["peers"]) {
			if reserved := peer["reserved"]; reserved != nil {
				settings["reserved"] = reserved
				break
			}
		}
		return map[string]any{"protocol": "wireguard", "settings": settings}, nil
	}
	return nil, fmt.Errorf("Xray cannot connect to %s servers; this protocol is not supported by Xray", str(source["type"]))
}

// streamSettings maps transport and TLS.
func streamSettings(source link.Outbound) (map[string]any, error) {
	stream := map[string]any{"network": "tcp", "security": "none"}

	if transport, _ := source["transport"].(map[string]any); transport != nil {
		switch str(transport["type"]) {
		case "ws":
			settings := map[string]any{"path": str(transport["path"])}
			if headers, _ := transport["headers"].(map[string]any); headers != nil {
				if host := str(headers["Host"]); host != "" {
					settings["host"] = host
				}
			}
			if early := num(transport["max_early_data"]); early > 0 {
				// Xray reads early data from the path, as share links write it.
				settings["path"] = str(transport["path"]) + "?ed=" + strconv.Itoa(early)
			}
			stream["network"], stream["wsSettings"] = "ws", settings
		case "grpc":
			stream["network"], stream["grpcSettings"] = "grpc", map[string]any{"serviceName": str(transport["service_name"])}
		case "httpupgrade":
			stream["network"], stream["httpupgradeSettings"] = "httpupgrade", map[string]any{"path": str(transport["path"]), "host": str(transport["host"])}
		case "xhttp":
			settings, err := xhttpSettings(transport)
			if err != nil {
				return nil, err
			}
			stream["network"], stream["xhttpSettings"] = "xhttp", settings
		case "http":
			// HTTP/2 transport is gone from current Xray; XHTTP replaced it.
			return nil, fmt.Errorf("Xray no longer has the HTTP/2 transport this server uses")
		case "quic":
			return nil, fmt.Errorf("Xray no longer has the QUIC transport this server uses")
		case "", "tcp", "raw":
		default:
			return nil, fmt.Errorf("this client cannot map transport %q to native Xray", str(transport["type"]))
		}
	}

	if tls, _ := source["tls"].(map[string]any); tls != nil && tls["enabled"] == true {
		fingerprint := ""
		if utls, _ := tls["utls"].(map[string]any); utls != nil {
			fingerprint = str(utls["fingerprint"])
		}
		if reality, _ := tls["reality"].(map[string]any); reality != nil && reality["enabled"] == true {
			if fingerprint == "" {
				fingerprint = "chrome"
			}
			stream["security"] = "reality"
			stream["realitySettings"] = map[string]any{
				"serverName":  str(tls["server_name"]),
				"fingerprint": fingerprint,
				"publicKey":   str(reality["public_key"]),
				"shortId":     str(reality["short_id"]),
				"spiderX":     str(reality["spider_x"]),
			}
		} else {
			settings := map[string]any{"serverName": str(tls["server_name"])}
			if alpn := texts(tls["alpn"]); len(alpn) > 0 {
				settings["alpn"] = alpn
			}
			if fingerprint != "" {
				settings["fingerprint"] = fingerprint
			}
			if tls["insecure"] == true {
				settings["allowInsecure"] = true
			}
			stream["security"] = "tls"
			stream["tlsSettings"] = settings
		}
	}
	return stream, nil
}

// xhttpSettings is Xray's XHTTP block. The finer settings already carry
// Xray's names (see link/xhttp.go) and go in "extra" as they are; only a
// separate downlink is reshaped, from the built-in core's form back into a
// stream setup of its own.
func xhttpSettings(transport map[string]any) (map[string]any, error) {
	settings := map[string]any{"path": str(transport["path"]), "host": str(transport["host"])}
	if mode := str(transport["mode"]); mode != "" {
		settings["mode"] = mode
	}
	extra := map[string]any{}
	for key, value := range transport {
		switch key {
		case "type", "host", "path", "mode":
		case "downloadSettings":
			download, _ := value.(map[string]any)
			if download == nil {
				continue
			}
			inner := map[string]any{"type": "xhttp"}
			for name, setting := range download {
				if name != "server" && name != "server_port" && name != "tls" {
					inner[name] = setting
				}
			}
			stream, err := streamSettings(link.Outbound{"tls": download["tls"], "transport": inner})
			if err != nil {
				return nil, err
			}
			stream["address"] = str(download["server"])
			stream["port"] = num(download["server_port"])
			extra["downloadSettings"] = stream
		default:
			extra[key] = value
		}
	}
	if len(extra) > 0 {
		settings["extra"] = extra
	}
	return settings, nil
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
	case uint32:
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

// Check reports why Xray cannot run a profile, the same refusal a connection
// to it would meet; nil when it can.
func Check(profile models.Profile, settings models.AppSettings) error {

	source, err := link.ParseOutbound(profile.ConfigLink, settings)
	if err != nil {
		return err
	}
	outbound, err := convert(source)
	if err != nil {
		return err
	}
	data, err := json.Marshal(outbound)
	if err != nil {
		return err
	}
	var native conf.OutboundDetourConfig
	if err = json.Unmarshal(data, &native); err != nil {
		return err
	}
	_, err = native.Build()
	return err
}
