// Package xray runs servers through Xray while the built-in core keeps the
// tunnel, DNS and routing.
//
// Xray is used as a protocol engine: for each server the routing needs, it
// gets a SOCKS entry point on loopback, and the built-in core sends that
// server's traffic there instead of dialing the server itself. Everything
// the app does with routing — rules, live counts, the connections screen,
// the kill switch — keeps working, because the built-in core still does it.
//
// Both run in the same process, so Xray's own connections to the servers
// cannot be told apart by program. Instead Xray dials through a
// password-protected SOCKS entry point on the built-in core that goes
// straight out (see sbconfig.Request.Bypass).
package xray

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"strconv"

	"github.com/Rigby-Foundation/NuggetVPN/internal/link"
	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Engine builds Xray's config as the built-in core asks for servers.
type Engine struct {
	settings models.AppSettings
	// chain are the hops every server is reached through, in dial order.
	chain []models.Profile

	inbounds  []map[string]any
	outbounds []map[string]any
	rules     []map[string]any
	domains   []string
	byProfile map[string]link.Outbound
	chainTag  string

	bypassPort int
	bypassUser string
	bypassPass string
}

// bypassTag is Xray's outbound to the built-in core's bypass entry point.
const bypassTag = "bypass"

// New prepares an engine. chain is the proxy chain, empty for none.
func New(settings models.AppSettings, chain []models.Profile) (*Engine, error) {
	port, err := freePort()
	if err != nil {
		return nil, err
	}
	engine := &Engine{
		settings: settings, byProfile: map[string]link.Outbound{},
		bypassPort: port, bypassUser: randomToken(), bypassPass: randomToken(),
		// Everything leaves through the bypass.
		chainTag: bypassTag,
	}
	engine.outbounds = append(engine.outbounds, map[string]any{
		"tag":      bypassTag,
		"protocol": "socks",
		"settings": map[string]any{"servers": []any{map[string]any{
			"address": "127.0.0.1", "port": port,
			"users": []any{map[string]any{"user": engine.bypassUser, "pass": engine.bypassPass}},
		}}},
	})
	// The hops come first; each dials through the previous one.
	for index, hop := range chain {
		tag := fmt.Sprintf("hop-%d", index+1)
		outbound, err := engine.outbound(hop, tag, engine.chainTag)
		if err != nil {
			return nil, fmt.Errorf("proxy chain hop %q: %w", hop.Name, err)
		}
		engine.outbounds = append(engine.outbounds, outbound)
		engine.chainTag = tag
	}
	return engine, nil
}

// Dial returns what the built-in core should use to reach profile: a SOCKS
// outbound to this profile's entry point in Xray.
func (e *Engine) Dial(profile models.Profile) (link.Outbound, error) {
	if existing, ok := e.byProfile[profile.ID]; ok && profile.ID != "" {
		return cloneOutbound(existing), nil
	}
	index := len(e.inbounds) + 1
	tag := fmt.Sprintf("server-%d", index)
	outbound, err := e.outbound(profile, tag, e.chainTag)
	if err != nil {
		return nil, err
	}
	port, err := freePort()
	if err != nil {
		return nil, err
	}
	user, pass := randomToken(), randomToken()
	inboundTag := fmt.Sprintf("in-%d", index)
	e.inbounds = append(e.inbounds, map[string]any{
		"tag":      inboundTag,
		"listen":   "127.0.0.1",
		"port":     port,
		"protocol": "socks",
		// A password, so no other program on this computer can use the
		// entry point as an open proxy.
		"settings": map[string]any{
			"auth":     "password",
			"accounts": []map[string]any{{"user": user, "pass": pass}},
			"udp":      true,
			"ip":       "127.0.0.1",
		},
	})
	e.outbounds = append(e.outbounds, outbound)
	e.rules = append(e.rules, map[string]any{"type": "field", "inboundTag": []string{inboundTag}, "outboundTag": tag})

	dial := link.Outbound{
		"type":        "socks",
		"server":      "127.0.0.1",
		"server_port": port,
		"version":     "5",
		"username":    user,
		"password":    pass,
		// Binding to an address keeps the core from pinning this dial to the
		// network interface, which loopback is not on.
		"inet4_bind_address": "127.0.0.1",
	}
	e.byProfile[profile.ID] = dial
	return cloneOutbound(dial), nil
}

// Bypass is the entry point on the built-in core Xray reaches the servers
// through: a loopback port and its credentials.
func (e *Engine) Bypass() (port int, username, password string) {
	return e.bypassPort, e.bypassUser, e.bypassPass
}

// ServerDomains are the servers' hostnames, which the built-in core must
// resolve without the tunnel: Xray looks them up through it.
func (e *Engine) ServerDomains() []string {
	return e.domains
}

// Config is Xray's config for everything asked for so far.
func (e *Engine) Config() ([]byte, error) {
	config := map[string]any{
		"log":       map[string]any{"loglevel": "warning"},
		"inbounds":  e.inbounds,
		"outbounds": append(append([]map[string]any{}, e.outbounds...), map[string]any{"tag": "block", "protocol": "blackhole"}),
		"routing": map[string]any{
			"domainStrategy": "AsIs",
			// Anything not arriving on an entry point has nowhere to go.
			"rules": append(append([]map[string]any{}, e.rules...), map[string]any{"type": "field", "network": "tcp,udp", "outboundTag": "block"}),
		},
	}
	return json.MarshalIndent(config, "", "  ")
}

// outbound converts a profile to an Xray outbound, dialing through via when
// set.
func (e *Engine) outbound(profile models.Profile, tag, via string) (map[string]any, error) {
	if _, full := link.FullConfig(profile.ConfigLink); full {
		return nil, fmt.Errorf("%s is a complete sing-box config, which Xray cannot run", profile.Name)
	}
	source, err := link.ParseOutbound(profile.ConfigLink, e.settings)
	if err != nil {
		return nil, err
	}
	result, err := convert(source)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", profile.Name, err)
	}
	result["tag"] = tag
	if via != "" {
		stream, _ := result["streamSettings"].(map[string]any)
		if stream == nil {
			stream = map[string]any{}
			result["streamSettings"] = stream
		}
		stream["sockopt"] = map[string]any{"dialerProxy": via}
	}
	if server := str(source["server"]); server != "" && net.ParseIP(server) == nil {
		e.domains = appendUnique(e.domains, server)
	}
	for _, peer := range list(source["peers"]) {
		if address := str(peer["address"]); address != "" && net.ParseIP(address) == nil {
			e.domains = appendUnique(e.domains, address)
		}
	}
	return result, nil
}

// convert maps a built-in outbound onto Xray's form.
func convert(source link.Outbound) (map[string]any, error) {
	server, port := str(source["server"]), num(source["server_port"])
	switch str(source["type"]) {
	case "vless":
		user := map[string]any{"id": str(source["uuid"]), "encryption": "none"}
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
				map[string]any{"id": str(source["uuid"]), "alterId": num(source["alter_id"]), "security": security},
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

	case "socks", "http":
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
		return map[string]any{"protocol": "wireguard", "settings": settings}, nil
	}
	return nil, fmt.Errorf("Xray cannot connect to %s servers; use the built-in core for this one", str(source["type"]))
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
			settings := map[string]any{"path": str(transport["path"]), "host": str(transport["host"])}
			if mode := str(transport["mode"]); mode != "" {
				settings["mode"] = mode
			}
			if padding := str(transport["xPaddingBytes"]); padding != "" {
				settings["extra"] = map[string]any{"xPaddingBytes": padding}
			}
			stream["network"], stream["xhttpSettings"] = "xhttp", settings
		case "http":
			// HTTP/2 transport is gone from current Xray; XHTTP replaced it.
			return nil, fmt.Errorf("Xray no longer has the HTTP/2 transport this server uses")
		case "quic":
			return nil, fmt.Errorf("Xray no longer has the QUIC transport this server uses")
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

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func cloneOutbound(source link.Outbound) link.Outbound {
	result := link.Outbound{}
	for key, value := range source {
		result[key] = value
	}
	return result
}

// freePort finds a loopback port nothing is listening on.
func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func randomToken() string {
	bytes := make([]byte, 12)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
