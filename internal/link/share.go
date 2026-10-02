package link

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Turning profiles back into share links.
//
// A profile imported from a link keeps that link, which is what gets shared.
// One imported as a sing-box or Xray JSON config, or legacy Clash YAML, has
// no link of its own: each server in it is encoded as the vless://, vmess://
// … link that describes it, so it can be added to another client.

// SharedLink is one server as a share link, named as the link's #fragment.
type SharedLink struct {
	Name string `json:"name"`
	Link string `json:"link"`
}

// ShareLinks returns the share links a stored profile describes: the link it
// was imported from, or one per server in a config. A server whose protocol
// has no share link form (WireGuard, SSH) is left out; an error means none of
// them could be.
func ShareLinks(raw, name string) ([]SharedLink, error) {
	trimmed := strings.TrimSpace(strings.ReplaceAll(raw, "&amp;", "&"))
	if trimmed == "" {
		return nil, fmt.Errorf("empty config link")
	}

	var outbounds []map[string]any
	switch {
	case strings.HasPrefix(trimmed, "{"):
		var root map[string]any
		if err := json.Unmarshal([]byte(trimmed), &root); err != nil {
			return nil, fmt.Errorf("invalid JSON config: %w", err)
		}
		outbounds = configServers(root)
	case looksLikeClashYAML(trimmed):
		outbound, err := outboundFromClashYAML(trimmed)
		if err != nil {
			return nil, err
		}
		outbounds = []map[string]any{outbound}
	default:
		// Already a share link: share it exactly as it came.
		return []SharedLink{{Name: name, Link: trimmed}}, nil
	}

	links := make([]SharedLink, 0, len(outbounds))
	var lastErr error
	for _, outbound := range outbounds {
		label := strings.TrimSpace(stringValue(outbound["tag"]))
		if label == "" || len(outbounds) == 1 {
			label = name
		}
		encoded, err := EncodeShareLink(outbound, label)
		if err != nil {
			lastErr = err
			continue
		}
		links = append(links, SharedLink{Name: label, Link: encoded})
	}
	if len(links) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("the config has no server to share")
		}
		return nil, lastErr
	}
	return links, nil
}

// configServers lists the servers in a sing-box or Xray config, or the one
// outbound object a profile can also store, as sing-box outbounds.
func configServers(root map[string]any) []map[string]any {
	if _, has := root["outbounds"]; !has {
		if _, xray := root["protocol"]; xray {
			if converted := xrayOutbound(root); converted != nil {
				return []map[string]any{converted}
			}
			return nil
		}
		return []map[string]any{sanitizeOutbound(root)}
	}
	list, _ := root["outbounds"].([]any)
	servers := make([]map[string]any, 0, len(list))
	for _, item := range list {
		outbound, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if _, xray := outbound["protocol"]; xray {
			if converted := xrayOutbound(outbound); converted != nil {
				servers = append(servers, converted)
			}
			continue
		}
		if isDialableOutbound(outbound) {
			servers = append(servers, sanitizeOutboundKeepTag(outbound))
		}
	}
	return servers
}

func sanitizeOutboundKeepTag(source map[string]any) map[string]any {
	outbound := sanitizeOutbound(source)
	if tag := stringValue(source["tag"]); tag != "" {
		outbound["tag"] = tag
	}
	return outbound
}

// xrayOutbound reads an Xray outbound into the sing-box shape the encoder
// takes. Only what a share link can say is read; nil means it is not a server
// (freedom, blackhole, dns) or not one a link can describe.
func xrayOutbound(source map[string]any) map[string]any {
	protocol := strings.ToLower(stringValue(source["protocol"]))
	settings, _ := source["settings"].(map[string]any)
	if settings == nil {
		return nil
	}
	first := func(key string) map[string]any {
		list, _ := settings[key].([]any)
		if len(list) == 0 {
			return nil
		}
		entry, _ := list[0].(map[string]any)
		return entry
	}
	outbound := map[string]any{"tag": stringValue(source["tag"])}

	switch protocol {
	case "vless", "vmess":
		server := first("vnext")
		// Newer Xray configs put the server straight in settings.
		if server == nil {
			server = settings
		}
		users, _ := server["users"].([]any)
		user := map[string]any{}
		if len(users) > 0 {
			user, _ = users[0].(map[string]any)
		} else if id := stringValue(server["id"]); id != "" {
			user = server
		}
		outbound["type"] = protocol
		outbound["server"] = stringValue(server["address"])
		outbound["server_port"] = intValue(server["port"])
		outbound["uuid"] = stringValue(user["id"])
		if protocol == "vless" {
			if flow := stringValue(user["flow"]); flow != "" {
				outbound["flow"] = flow
			}
			if encryption := stringValue(user["encryption"]); encryption != "" && !strings.EqualFold(encryption, "none") {
				outbound["encryption"] = encryption
			}
		} else {
			outbound["security"] = defaultString(stringValue(user["security"]), "auto")
			if alterID := intValue(user["alterId"]); alterID > 0 {
				outbound["alter_id"] = alterID
			}
		}
	case "trojan":
		server := first("servers")
		if server == nil {
			server = settings
		}
		outbound["type"] = "trojan"
		outbound["server"] = stringValue(server["address"])
		outbound["server_port"] = intValue(server["port"])
		outbound["password"] = stringValue(server["password"])
	case "shadowsocks":
		server := first("servers")
		if server == nil {
			server = settings
		}
		outbound["type"] = "shadowsocks"
		outbound["server"] = stringValue(server["address"])
		outbound["server_port"] = intValue(server["port"])
		outbound["method"] = stringValue(server["method"])
		outbound["password"] = stringValue(server["password"])
	case "hysteria", "hysteria2":
		outbound["type"] = "hysteria2"
		outbound["server"] = stringValue(settings["address"])
		outbound["server_port"] = intValue(settings["port"])
		if password := stringValue(settings["password"]); password != "" {
			outbound["password"] = password
		}
	case "socks", "http":
		server := first("servers")
		if server == nil {
			return nil
		}
		outbound["type"] = protocol
		outbound["server"] = stringValue(server["address"])
		outbound["server_port"] = intValue(server["port"])
		if users, _ := server["users"].([]any); len(users) > 0 {
			if user, ok := users[0].(map[string]any); ok {
				outbound["username"] = stringValue(user["user"])
				outbound["password"] = stringValue(user["pass"])
			}
		}
	default:
		return nil
	}
	if stringValue(outbound["server"]) == "" || intValue(outbound["server_port"]) == 0 {
		return nil
	}

	stream, _ := source["streamSettings"].(map[string]any)
	if stream == nil {
		if outbound["type"] == "hysteria2" {
			outbound["tls"] = map[string]any{"enabled": true, "server_name": outbound["server"]}
		}
		return outbound
	}
	security := strings.ToLower(stringValue(stream["security"]))
	switch security {
	case "tls":
		settings, _ := stream["tlsSettings"].(map[string]any)
		outbound["tls"] = xrayTLS(settings, false)
	case "reality":
		settings, _ := stream["realitySettings"].(map[string]any)
		outbound["tls"] = xrayTLS(settings, true)
	default:
		if outbound["type"] == "hysteria2" {
			outbound["tls"] = map[string]any{"enabled": true, "server_name": outbound["server"]}
		}
	}
	if transport := xrayTransport(stream); transport != nil {
		outbound["transport"] = transport
	}
	return outbound
}

func xrayTLS(settings map[string]any, reality bool) map[string]any {
	tls := map[string]any{"enabled": true, "server_name": stringValue(settings["serverName"])}
	if alpn := stringList(settings["alpn"]); len(alpn) > 0 {
		tls["alpn"] = alpn
	}
	if fingerprint := stringValue(settings["fingerprint"]); fingerprint != "" {
		tls["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
	}
	if settings["allowInsecure"] == true {
		tls["insecure"] = true
	}
	if reality {
		tls["reality"] = map[string]any{
			"enabled":    true,
			"public_key": defaultString(stringValue(settings["publicKey"]), stringValue(settings["password"])),
			"short_id":   stringValue(settings["shortId"]),
		}
	}
	return tls
}

func xrayTransport(stream map[string]any) map[string]any {
	network := normalizeTransport(stringValue(stream["network"]))
	section := func(name string) map[string]any {
		value, _ := stream[name].(map[string]any)
		if value == nil {
			value = map[string]any{}
		}
		return value
	}
	switch network {
	case "ws":
		ws := section("wsSettings")
		host := stringValue(ws["host"])
		if headers, ok := ws["headers"].(map[string]any); ok && host == "" {
			host = stringValue(headers["Host"])
		}
		return map[string]any{"type": "ws", "path": defaultString(stringValue(ws["path"]), "/"), "headers": map[string]any{"Host": host}}
	case "grpc":
		return map[string]any{"type": "grpc", "service_name": stringValue(section("grpcSettings")["serviceName"])}
	case "http":
		h2 := section("httpSettings")
		return map[string]any{"type": "http", "host": stringList(h2["host"]), "path": defaultString(stringValue(h2["path"]), "/")}
	case "httpupgrade":
		upgrade := section("httpupgradeSettings")
		return map[string]any{"type": "httpupgrade", "host": stringValue(upgrade["host"]), "path": defaultString(stringValue(upgrade["path"]), "/")}
	case "xhttp":
		xhttp := section("xhttpSettings")
		if len(xhttp) == 0 {
			xhttp = section("splithttpSettings")
		}
		transport := map[string]any{
			"type": "xhttp",
			"host": stringValue(xhttp["host"]),
			"path": defaultString(stringValue(xhttp["path"]), "/"),
		}
		if mode := stringValue(xhttp["mode"]); mode != "" {
			transport["mode"] = mode
		}
		mergeXHTTP(transport, xhttp)
		return transport
	case "quic":
		return map[string]any{"type": "quic"}
	}
	return nil
}

// EncodeShareLink writes a sing-box outbound as the share link that parses
// back into it.
func EncodeShareLink(outbound map[string]any, name string) (string, error) {
	kind := stringValue(outbound["type"])
	host := stringValue(outbound["server"])
	port := intValue(outbound["server_port"])
	if host == "" || port == 0 {
		return "", fmt.Errorf("%s server has no address", kind)
	}
	address := net.JoinHostPort(host, strconv.Itoa(port))
	tls, _ := outbound["tls"].(map[string]any)
	transport, _ := outbound["transport"].(map[string]any)
	fragment := ""
	if name != "" {
		fragment = "#" + url.PathEscape(name)
	}

	switch kind {
	case "vless":
		params := url.Values{}
		params.Set("encryption", defaultString(stringValue(outbound["encryption"]), "none"))
		if flow := stringValue(outbound["flow"]); flow != "" {
			params.Set("flow", flow)
		}
		writeTLS(params, tls, host)
		writeTransport(params, transport)
		return "vless://" + url.PathEscape(stringValue(outbound["uuid"])) + "@" + address + "?" + params.Encode() + fragment, nil

	case "trojan":
		params := url.Values{}
		writeTLS(params, tls, host)
		writeTransport(params, transport)
		return "trojan://" + url.PathEscape(stringValue(outbound["password"])) + "@" + address + "?" + params.Encode() + fragment, nil

	case "vmess":
		params := url.Values{}
		writeTransport(params, transport)
		payload := map[string]any{
			"v": "2", "ps": name, "add": host, "port": strconv.Itoa(port),
			"id":  stringValue(outbound["uuid"]),
			"aid": strconv.Itoa(intValue(outbound["alter_id"])),
			"scy": defaultString(stringValue(outbound["security"]), "auto"),
			"net": defaultString(params.Get("type"), "tcp"), "type": "none",
			"host": params.Get("host"), "path": params.Get("path"), "tls": "",
		}
		if service := params.Get("serviceName"); service != "" {
			payload["path"] = service
		}
		if tls != nil && tls["enabled"] != false {
			payload["tls"] = "tls"
			payload["sni"] = stringValue(tls["server_name"])
			if alpn := stringList(tls["alpn"]); len(alpn) > 0 {
				payload["alpn"] = strings.Join(alpn, ",")
			}
			if utls, ok := tls["utls"].(map[string]any); ok {
				payload["fp"] = stringValue(utls["fingerprint"])
			}
		}
		encoded, err := json.Marshal(payload)
		if err != nil {
			return "", err
		}
		return "vmess://" + base64.StdEncoding.EncodeToString(encoded), nil

	case "shadowsocks":
		credentials := base64.RawURLEncoding.EncodeToString([]byte(stringValue(outbound["method"]) + ":" + stringValue(outbound["password"])))
		query := ""
		if plugin := stringValue(outbound["plugin"]); plugin != "" {
			value := plugin
			if opts := stringValue(outbound["plugin_opts"]); opts != "" {
				value += ";" + opts
			}
			query = "?" + url.Values{"plugin": {value}}.Encode()
		}
		return "ss://" + credentials + "@" + address + query + fragment, nil

	case "hysteria2":
		params := url.Values{}
		writeTLS(params, tls, host)
		params.Del("security")
		if obfs, ok := outbound["obfs"].(map[string]any); ok && stringValue(obfs["type"]) != "" {
			params.Set("obfs", stringValue(obfs["type"]))
			params.Set("obfs-password", stringValue(obfs["password"]))
		}
		if up := intValue(outbound["up_mbps"]); up > 0 {
			params.Set("upmbps", strconv.Itoa(up))
		}
		if down := intValue(outbound["down_mbps"]); down > 0 {
			params.Set("downmbps", strconv.Itoa(down))
		}
		user := ""
		if password := stringValue(outbound["password"]); password != "" {
			user = url.PathEscape(password) + "@"
		}
		return "hysteria2://" + user + address + "/?" + params.Encode() + fragment, nil

	case "hysteria":
		params := url.Values{}
		writeTLS(params, tls, host)
		params.Del("security")
		if sni := params.Get("sni"); sni != "" {
			params.Set("peer", sni)
		}
		if auth := stringValue(outbound["auth_str"]); auth != "" {
			params.Set("auth", auth)
		}
		if obfs := stringValue(outbound["obfs"]); obfs != "" {
			params.Set("obfsParam", obfs)
		}
		params.Set("upmbps", strconv.Itoa(defaultInt(intValue(outbound["up_mbps"]), 100)))
		params.Set("downmbps", strconv.Itoa(defaultInt(intValue(outbound["down_mbps"]), 100)))
		return "hysteria://" + address + "?" + params.Encode() + fragment, nil

	case "tuic":
		params := url.Values{}
		writeTLS(params, tls, host)
		params.Del("security")
		if congestion := stringValue(outbound["congestion_control"]); congestion != "" {
			params.Set("congestion_control", congestion)
		}
		if mode := stringValue(outbound["udp_relay_mode"]); mode != "" {
			params.Set("udp_relay_mode", mode)
		}
		user := url.PathEscape(stringValue(outbound["uuid"]))
		if password := stringValue(outbound["password"]); password != "" {
			user += ":" + url.PathEscape(password)
		}
		return "tuic://" + user + "@" + address + "?" + params.Encode() + fragment, nil

	case "socks", "http":
		scheme := map[string]string{"socks": "socks5", "http": "http"}[kind]
		if kind == "http" && tls != nil && tls["enabled"] != false {
			scheme = "https"
		}
		user := ""
		if username := stringValue(outbound["username"]); username != "" {
			user = url.UserPassword(username, stringValue(outbound["password"])).String() + "@"
		}
		return scheme + "://" + user + address + fragment, nil
	}
	return "", &ErrUnsupportedProtocol{Scheme: kind, Reason: "it has no share link form"}
}

// writeTLS sets the TLS and Reality parameters parseVLESS and friends read.
func writeTLS(params url.Values, tls map[string]any, host string) {
	if tls == nil || tls["enabled"] == false {
		params.Set("security", "none")
		return
	}
	reality, _ := tls["reality"].(map[string]any)
	if reality != nil && reality["enabled"] != false {
		params.Set("security", "reality")
		params.Set("pbk", stringValue(reality["public_key"]))
		if shortID := stringValue(reality["short_id"]); shortID != "" {
			params.Set("sid", shortID)
		}
	} else {
		params.Set("security", "tls")
	}
	if serverName := stringValue(tls["server_name"]); serverName != "" && serverName != host {
		params.Set("sni", serverName)
	} else if serverName != "" {
		params.Set("sni", serverName)
	}
	if alpn := stringList(tls["alpn"]); len(alpn) > 0 {
		params.Set("alpn", strings.Join(alpn, ","))
	}
	if utls, ok := tls["utls"].(map[string]any); ok {
		if fingerprint := stringValue(utls["fingerprint"]); fingerprint != "" {
			params.Set("fp", fingerprint)
		}
	}
	if tls["insecure"] == true {
		params.Set("allowInsecure", "1")
	}
}

// writeTransport sets the transport parameters buildTransport reads.
func writeTransport(params url.Values, transport map[string]any) {
	if transport == nil {
		params.Set("type", "tcp")
		return
	}
	kind := stringValue(transport["type"])
	switch kind {
	case "ws":
		params.Set("type", "ws")
		path := stringValue(transport["path"])
		if early := intValue(transport["max_early_data"]); early > 0 {
			path += "?ed=" + strconv.Itoa(early)
		}
		params.Set("path", path)
		if headers, ok := transport["headers"].(map[string]any); ok {
			if host := stringValue(headers["Host"]); host != "" {
				params.Set("host", host)
			}
		}
	case "grpc":
		params.Set("type", "grpc")
		params.Set("serviceName", stringValue(transport["service_name"]))
	case "http":
		params.Set("type", "http")
		params.Set("path", stringValue(transport["path"]))
		if hosts := stringList(transport["host"]); len(hosts) > 0 {
			params.Set("host", hosts[0])
		}
	case "httpupgrade", "xhttp":
		params.Set("type", kind)
		params.Set("path", stringValue(transport["path"]))
		if host := stringValue(transport["host"]); host != "" {
			params.Set("host", host)
		}
		if kind == "xhttp" {
			if mode := stringValue(transport["mode"]); mode != "" {
				params.Set("mode", mode)
			}
			// Everything past host, path and mode rides in "extra", as
			// Xray's own JSON for the transport.
			extra := map[string]any{}
			for key, value := range transport {
				switch key {
				case "type", "host", "path", "mode":
				default:
					extra[key] = value
				}
			}
			if len(extra) > 0 {
				if encoded, err := json.Marshal(extra); err == nil {
					params.Set("extra", string(encoded))
				}
			}
		}
	case "quic":
		params.Set("type", "quic")
	default:
		params.Set("type", "tcp")
	}
}

func stringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		list := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringValue(item); text != "" {
				list = append(list, text)
			}
		}
		return list
	case string:
		return splitList(typed)
	}
	return nil
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
