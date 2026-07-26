// Package link turns share links, sing-box JSON and legacy Clash YAML into
// sing-box outbound objects.
package link

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// Outbound is a sing-box outbound (or endpoint) object. It stays a generic map
// because the field set differs per protocol and sing-box validates it during
// option unmarshalling anyway.
type Outbound map[string]any

// Type reports the sing-box outbound type.
func (o Outbound) Type() string { return stringValue(o["type"]) }

// Server reports the remote host, used by the ping and connectivity probes.
func (o Outbound) Server() string { return stringValue(o["server"]) }

// ServerPort reports the remote port, used by the connectivity probe.
func (o Outbound) ServerPort() int { return intValue(o["server_port"]) }

// IsEndpoint reports whether this object belongs in `endpoints` rather than
// `outbounds`. sing-box moved WireGuard to endpoints in 1.11.
func (o Outbound) IsEndpoint() bool { return o.Type() == "wireguard" }

// ErrUnsupportedProtocol is returned for schemes sing-box cannot dial.
type ErrUnsupportedProtocol struct {
	Scheme string
	Reason string
}

func (e *ErrUnsupportedProtocol) Error() string {
	if e.Reason != "" {
		return fmt.Sprintf("%s:// is not supported by the sing-box core: %s", e.Scheme, e.Reason)
	}
	return fmt.Sprintf("%s:// is not supported by the sing-box core", e.Scheme)
}

// ParseOutbound converts one stored profile link into a sing-box outbound.
// The returned object carries no `tag`; the config builder assigns it.
func ParseOutbound(rawLink string, settings models.AppSettings) (Outbound, error) {
	raw := strings.TrimSpace(strings.ReplaceAll(rawLink, "&amp;", "&"))
	if raw == "" {
		return nil, fmt.Errorf("empty config link")
	}

	// A profile may store a whole sing-box config or a single outbound object.
	if strings.HasPrefix(raw, "{") {
		outbound, err := outboundFromSingBoxJSON(raw)
		if err != nil {
			return nil, err
		}
		applySNISpoof(outbound, settings)
		return outbound, nil
	}

	// Legacy Clash YAML profiles saved by earlier builds.
	if looksLikeClashYAML(raw) {
		outbound, err := outboundFromClashYAML(raw)
		if err != nil {
			return nil, err
		}
		applySNISpoof(outbound, settings)
		return outbound, nil
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid link format: %w", err)
	}

	var outbound Outbound
	switch strings.ToLower(parsed.Scheme) {
	case "vless":
		outbound, err = parseVLESS(parsed)
	case "vmess":
		outbound, err = parseVMess(raw)
	case "trojan":
		outbound, err = parseTrojan(parsed)
	case "ss":
		outbound, err = parseShadowsocks(raw, parsed)
	case "hy2", "hysteria2":
		outbound, err = parseHysteria2(parsed)
	case "hy", "hysteria":
		outbound, err = parseHysteria(parsed)
	case "tuic":
		outbound, err = parseTUIC(parsed)
	case "wg", "wireguard":
		outbound, err = parseWireGuard(parsed)
	case "socks", "socks4", "socks5":
		outbound, err = parseSOCKS(parsed)
	case "http", "https":
		outbound, err = parseHTTP(parsed)
	case "ssh":
		outbound, err = parseSSH(parsed)
	case "rigby":
		return nil, &ErrUnsupportedProtocol{
			Scheme: "rigby",
			Reason: "it is a clash-rs fork protocol with no sing-box implementation",
		}
	default:
		return nil, &ErrUnsupportedProtocol{Scheme: parsed.Scheme}
	}
	if err != nil {
		return nil, err
	}

	applySNISpoof(outbound, settings)
	return outbound, nil
}

// ---------------------------------------------------------------------------
// VLESS
// ---------------------------------------------------------------------------

func parseVLESS(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 0)
	if err != nil {
		return nil, err
	}
	uuid := u.User.Username()
	if uuid == "" {
		return nil, fmt.Errorf("vless link is missing the UUID")
	}

	params := u.Query()
	outbound := Outbound{
		"type":        "vless",
		"server":      host,
		"server_port": port,
		"uuid":        uuid,
	}

	security := strings.ToLower(firstParam(params, "security"))
	transportType := normalizeTransport(firstParam(params, "type"))

	if tlsOpts := buildTLS(params, host, security == "reality", security == "tls" || security == "reality" || security == "xtls"); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}

	// XTLS Vision only works on the raw TCP transport with TLS/Reality on.
	if flow := strings.TrimSpace(firstParam(params, "flow")); flow != "" {
		if transportType == "" && outbound["tls"] != nil {
			outbound["flow"] = flow
		}
	}

	if transport := buildTransport(transportType, params, host); transport != nil {
		outbound["transport"] = transport
	}
	return outbound, nil
}

// ---------------------------------------------------------------------------
// VMess
// ---------------------------------------------------------------------------

func parseVMess(raw string) (Outbound, error) {
	payload, ok := strings.CutPrefix(raw, "vmess://")
	if !ok {
		return nil, fmt.Errorf("invalid vmess link")
	}
	// Strip an optional #fragment before base64 decoding.
	if index := strings.IndexByte(payload, '#'); index >= 0 {
		payload = payload[:index]
	}
	decoded, err := decodeBase64(strings.TrimSpace(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to decode vmess link: %w", err)
	}
	var config map[string]any
	if err := json.Unmarshal(decoded, &config); err != nil {
		return nil, fmt.Errorf("failed to parse vmess payload: %w", err)
	}

	server := stringValue(config["add"])
	if server == "" {
		return nil, fmt.Errorf("vmess payload is missing the server address")
	}
	port := intValue(config["port"])
	if port == 0 {
		port = 443
	}
	uuid := stringValue(config["id"])
	if uuid == "" {
		return nil, fmt.Errorf("vmess payload is missing the UUID")
	}

	security := stringValue(config["scy"])
	if security == "" {
		security = "auto"
	}

	outbound := Outbound{
		"type":        "vmess",
		"server":      server,
		"server_port": port,
		"uuid":        uuid,
		"security":    security,
	}
	if alterID := intValue(config["aid"]); alterID > 0 {
		outbound["alter_id"] = alterID
	}

	// vmess links describe transport through flat keys rather than a query.
	params := url.Values{}
	setIfNotEmpty(params, "path", stringValue(config["path"]))
	setIfNotEmpty(params, "host", stringValue(config["host"]))
	setIfNotEmpty(params, "serviceName", stringValue(config["path"]))
	setIfNotEmpty(params, "sni", stringValue(config["sni"]))
	setIfNotEmpty(params, "alpn", stringValue(config["alpn"]))
	setIfNotEmpty(params, "fp", stringValue(config["fp"]))

	tlsMode := strings.ToLower(stringValue(config["tls"]))
	if tlsOpts := buildTLS(params, server, false, tlsMode == "tls" || tlsMode == "reality"); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}

	network := normalizeTransport(stringValue(config["net"]))
	if network == "grpc" {
		// vmess links carry the gRPC service name in `path`.
		params.Set("serviceName", strings.TrimPrefix(stringValue(config["path"]), "/"))
	}
	if transport := buildTransport(network, params, server); transport != nil {
		outbound["transport"] = transport
	}
	return outbound, nil
}

// ---------------------------------------------------------------------------
// Trojan
// ---------------------------------------------------------------------------

func parseTrojan(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 443)
	if err != nil {
		return nil, err
	}
	password := u.User.Username()
	if password == "" {
		return nil, fmt.Errorf("trojan link is missing the password")
	}

	params := u.Query()
	outbound := Outbound{
		"type":        "trojan",
		"server":      host,
		"server_port": port,
		"password":    password,
	}

	// Trojan is TLS-only unless the link explicitly disables it.
	security := strings.ToLower(firstParam(params, "security"))
	if tlsOpts := buildTLS(params, host, security == "reality", security != "none"); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}
	if transport := buildTransport(normalizeTransport(firstParam(params, "type")), params, host); transport != nil {
		outbound["transport"] = transport
	}
	return outbound, nil
}

// ---------------------------------------------------------------------------
// Shadowsocks
// ---------------------------------------------------------------------------

func parseShadowsocks(raw string, u *url.URL) (Outbound, error) {
	method, password, host, port, err := decodeShadowsocksCredentials(raw, u)
	if err != nil {
		return nil, err
	}

	outbound := Outbound{
		"type":        "shadowsocks",
		"server":      host,
		"server_port": port,
		"method":      method,
		"password":    password,
	}

	params := u.Query()
	if plugin := strings.TrimSpace(params.Get("plugin")); plugin != "" {
		// The plugin string packs its own options after the first ';'.
		name, opts, _ := strings.Cut(plugin, ";")
		switch {
		case strings.HasPrefix(name, "v2ray-plugin"), strings.HasPrefix(name, "xray-plugin"):
			outbound["plugin"] = "v2ray-plugin"
		case strings.HasPrefix(name, "obfs-local"), strings.HasPrefix(name, "simple-obfs"):
			outbound["plugin"] = "obfs-local"
		default:
			outbound["plugin"] = name
		}
		if extra := strings.TrimSpace(params.Get("plugin-opts")); extra != "" {
			if opts == "" {
				opts = extra
			} else {
				opts = opts + ";" + extra
			}
		}
		if opts != "" {
			outbound["plugin_opts"] = opts
		}
	}
	return outbound, nil
}

// decodeShadowsocksCredentials handles both SIP002
// (ss://base64(method:password)@host:port) and the legacy fully-base64 form
// (ss://base64(method:password@host:port)).
func decodeShadowsocksCredentials(raw string, u *url.URL) (method, password, host string, port int, err error) {
	if u.User != nil && u.Hostname() != "" {
		userInfo := u.User.Username()
		if pass, ok := u.User.Password(); ok && pass != "" {
			// Already plain `method:password`.
			method, password = userInfo, pass
		} else if decoded, decodeErr := decodeBase64(userInfo); decodeErr == nil {
			parts := strings.SplitN(string(decoded), ":", 2)
			if len(parts) == 2 {
				method, password = parts[0], parts[1]
			}
		}
		if method != "" && password != "" {
			host, port, err = hostPort(u, 0)
			return method, password, host, port, err
		}
	}

	// Legacy form: the whole body after ss:// is base64.
	body := strings.TrimPrefix(raw, "ss://")
	if index := strings.IndexByte(body, '#'); index >= 0 {
		body = body[:index]
	}
	if index := strings.IndexByte(body, '?'); index >= 0 {
		body = body[:index]
	}
	decoded, decodeErr := decodeBase64(body)
	if decodeErr != nil {
		return "", "", "", 0, fmt.Errorf("invalid shadowsocks link")
	}
	credentials, endpoint, found := strings.Cut(string(decoded), "@")
	if !found {
		return "", "", "", 0, fmt.Errorf("invalid shadowsocks link")
	}
	method, password, found = strings.Cut(credentials, ":")
	if !found {
		return "", "", "", 0, fmt.Errorf("invalid shadowsocks credentials")
	}
	hostPart, portPart, found := strings.Cut(endpoint, ":")
	if !found {
		return "", "", "", 0, fmt.Errorf("invalid shadowsocks endpoint")
	}
	parsedPort, convErr := strconv.Atoi(strings.TrimSpace(portPart))
	if convErr != nil {
		return "", "", "", 0, fmt.Errorf("invalid shadowsocks port")
	}
	return method, password, hostPart, parsedPort, nil
}

// ---------------------------------------------------------------------------
// Hysteria / Hysteria2 / TUIC
// ---------------------------------------------------------------------------

func parseHysteria2(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 443)
	if err != nil {
		return nil, err
	}
	params := u.Query()

	password := u.User.Username()
	if pass, ok := u.User.Password(); ok && pass != "" {
		password = password + ":" + pass
	}
	if password == "" {
		password = firstParam(params, "auth", "password")
	}

	outbound := Outbound{
		"type":        "hysteria2",
		"server":      host,
		"server_port": port,
	}
	if password != "" {
		outbound["password"] = password
	}
	// hysteria2 is QUIC based, so TLS is always on.
	if tlsOpts := buildTLS(params, host, false, true); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}
	if obfs := strings.TrimSpace(firstParam(params, "obfs")); obfs != "" && obfs != "none" {
		outbound["obfs"] = map[string]any{
			"type":     obfs,
			"password": firstParam(params, "obfs-password", "obfs_password"),
		}
	}
	if up := intParam(params, "upmbps", "up_mbps", "up"); up > 0 {
		outbound["up_mbps"] = up
	}
	if down := intParam(params, "downmbps", "down_mbps", "down"); down > 0 {
		outbound["down_mbps"] = down
	}
	return outbound, nil
}

func parseHysteria(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 443)
	if err != nil {
		return nil, err
	}
	params := u.Query()

	outbound := Outbound{
		"type":        "hysteria",
		"server":      host,
		"server_port": port,
		"up_mbps":     defaultInt(intParam(params, "upmbps", "up_mbps", "up"), 100),
		"down_mbps":   defaultInt(intParam(params, "downmbps", "down_mbps", "down"), 100),
	}
	if auth := firstParam(params, "auth", "authStr", "auth_str"); auth != "" {
		outbound["auth_str"] = auth
	}
	if obfs := strings.TrimSpace(firstParam(params, "obfs", "obfsParam")); obfs != "" && obfs != "none" {
		outbound["obfs"] = obfs
	}
	// Hysteria v1 calls the SNI parameter `peer`.
	if peer := firstParam(params, "peer"); peer != "" && params.Get("sni") == "" {
		params.Set("sni", peer)
	}
	if tlsOpts := buildTLS(params, host, false, true); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}
	return outbound, nil
}

func parseTUIC(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 443)
	if err != nil {
		return nil, err
	}
	params := u.Query()

	outbound := Outbound{
		"type":        "tuic",
		"server":      host,
		"server_port": port,
	}
	if uuid := u.User.Username(); uuid != "" {
		outbound["uuid"] = uuid
	}
	if password, ok := u.User.Password(); ok && password != "" {
		outbound["password"] = password
	}
	if congestion := firstParam(params, "congestion_control", "congestion-control"); congestion != "" {
		outbound["congestion_control"] = congestion
	} else {
		outbound["congestion_control"] = "bbr"
	}
	if mode := firstParam(params, "udp_relay_mode", "udp-relay-mode"); mode != "" {
		outbound["udp_relay_mode"] = mode
	} else {
		outbound["udp_relay_mode"] = "native"
	}
	if boolParam(params, "zero_rtt_handshake", "reduce_rtt") {
		outbound["zero_rtt_handshake"] = true
	}
	if tlsOpts := buildTLS(params, host, false, true); tlsOpts != nil {
		outbound["tls"] = tlsOpts
	}
	return outbound, nil
}

// ---------------------------------------------------------------------------
// WireGuard (a sing-box endpoint, not an outbound)
// ---------------------------------------------------------------------------

func parseWireGuard(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 51820)
	if err != nil {
		return nil, err
	}
	params := u.Query()

	privateKey := u.User.Username()
	if privateKey == "" {
		privateKey = firstParam(params, "privatekey", "private_key", "secretkey")
	}
	if privateKey == "" {
		return nil, fmt.Errorf("wireguard link is missing the private key")
	}

	addresses := splitList(firstParam(params, "address", "ip", "addresses"))
	if len(addresses) == 0 {
		addresses = []string{"10.0.0.2/32"}
	}
	for i, address := range addresses {
		// Bare addresses need an explicit prefix length for sing-box.
		if !strings.Contains(address, "/") {
			if strings.Contains(address, ":") {
				addresses[i] = address + "/128"
			} else {
				addresses[i] = address + "/32"
			}
		}
	}

	peer := map[string]any{
		"address":     host,
		"port":        port,
		"public_key":  firstParam(params, "publickey", "public_key", "peer_public_key"),
		"allowed_ips": []string{"0.0.0.0/0", "::/0"},
	}
	if preSharedKey := firstParam(params, "presharedkey", "pre_shared_key", "psk"); preSharedKey != "" {
		peer["pre_shared_key"] = preSharedKey
	}
	if keepalive := intParam(params, "keepalive", "persistent_keepalive_interval"); keepalive > 0 {
		peer["persistent_keepalive_interval"] = keepalive
	}
	if reserved := splitList(params.Get("reserved")); len(reserved) == 3 {
		values := make([]int, 0, 3)
		for _, item := range reserved {
			value, err := strconv.Atoi(item)
			if err != nil {
				values = nil
				break
			}
			values = append(values, value)
		}
		if values != nil {
			peer["reserved"] = values
		}
	}

	endpoint := Outbound{
		"type":        "wireguard",
		"address":     addresses,
		"private_key": privateKey,
		"peers":       []any{peer},
		// Retained so the ping/probe helpers can still reach the endpoint.
		"server":      host,
		"server_port": port,
	}
	if mtu := intParam(params, "mtu"); mtu > 0 {
		endpoint["mtu"] = mtu
	}
	return endpoint, nil
}

// ---------------------------------------------------------------------------
// SOCKS / HTTP / SSH
// ---------------------------------------------------------------------------

func parseSOCKS(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 1080)
	if err != nil {
		return nil, err
	}
	version := "5"
	if strings.EqualFold(u.Scheme, "socks4") {
		version = "4"
	}
	outbound := Outbound{
		"type":        "socks",
		"server":      host,
		"server_port": port,
		"version":     version,
	}
	if username := u.User.Username(); username != "" {
		outbound["username"] = username
		if password, ok := u.User.Password(); ok {
			outbound["password"] = password
		}
	}
	return outbound, nil
}

func parseHTTP(u *url.URL) (Outbound, error) {
	defaultPort := 80
	if strings.EqualFold(u.Scheme, "https") {
		defaultPort = 443
	}
	host, port, err := hostPort(u, defaultPort)
	if err != nil {
		return nil, err
	}
	outbound := Outbound{
		"type":        "http",
		"server":      host,
		"server_port": port,
	}
	if username := u.User.Username(); username != "" {
		outbound["username"] = username
		if password, ok := u.User.Password(); ok {
			outbound["password"] = password
		}
	}
	if strings.EqualFold(u.Scheme, "https") {
		outbound["tls"] = buildTLS(u.Query(), host, false, true)
	}
	return outbound, nil
}

func parseSSH(u *url.URL) (Outbound, error) {
	host, port, err := hostPort(u, 22)
	if err != nil {
		return nil, err
	}
	params := u.Query()
	outbound := Outbound{
		"type":        "ssh",
		"server":      host,
		"server_port": port,
	}
	if user := u.User.Username(); user != "" {
		outbound["user"] = user
	}
	if password, ok := u.User.Password(); ok && password != "" {
		outbound["password"] = password
	}
	if key := firstParam(params, "private_key", "privateKey"); key != "" {
		outbound["private_key"] = key
	}
	if passphrase := firstParam(params, "private_key_passphrase", "privateKeyPassphrase"); passphrase != "" {
		outbound["private_key_passphrase"] = passphrase
	}
	if hostKeys := splitList(firstParam(params, "host_key", "hostKey")); len(hostKeys) > 0 {
		outbound["host_key"] = hostKeys
	}
	return outbound, nil
}

// ---------------------------------------------------------------------------
// TLS and transport helpers
// ---------------------------------------------------------------------------

// buildTLS assembles the sing-box TLS block.
//
// Reality is the reason this app exists: sing-box implements Reality on top of
// uTLS, so whenever Reality is on we must also emit a `utls` block. A missing
// fingerprint defaults to chrome rather than being left empty.
func buildTLS(params url.Values, host string, reality bool, enabled bool) map[string]any {
	if !enabled {
		return nil
	}

	serverName := firstParam(params, "sni", "peer", "servername", "server_name", "host")
	if serverName == "" {
		serverName = host
	}

	tlsOpts := map[string]any{
		"enabled":     true,
		"server_name": serverName,
	}

	if alpn := splitList(firstParam(params, "alpn")); len(alpn) > 0 {
		tlsOpts["alpn"] = alpn
	}

	fingerprint := firstParam(params, "fp", "fingerprint", "client-fingerprint", "client_fingerprint")

	if reality {
		if fingerprint == "" {
			fingerprint = "chrome"
		}
		tlsOpts["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
		tlsOpts["reality"] = map[string]any{
			"enabled":    true,
			"public_key": firstParam(params, "pbk", "public-key", "public_key"),
			"short_id":   firstParam(params, "sid", "short-id", "short_id"),
		}
		// Reality pins the server key itself; `insecure` is meaningless here.
		return tlsOpts
	}

	if fingerprint != "" {
		tlsOpts["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
	}
	if boolParam(params, "allowInsecure", "insecure", "allow_insecure", "skip-cert-verify") {
		tlsOpts["insecure"] = true
	}
	return tlsOpts
}

// normalizeTransport maps the many spellings of a transport onto sing-box's.
// An empty result means plain TCP, which sing-box expresses by omitting the
// transport block entirely.
func normalizeTransport(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "ws", "websocket":
		return "ws"
	case "grpc", "gun":
		return "grpc"
	case "h2", "http", "h2c":
		return "http"
	case "httpupgrade":
		return "httpupgrade"
	case "quic":
		return "quic"
	default:
		return ""
	}
}

func buildTransport(transportType string, params url.Values, host string) map[string]any {
	switch transportType {
	case "ws":
		path := firstParam(params, "path")
		if path == "" {
			path = "/"
		}
		// v2ray encodes early data support inside the path (`/path?ed=2048`).
		maxEarlyData := 0
		if base, query, found := strings.Cut(path, "?"); found {
			path = base
			if values, err := url.ParseQuery(query); err == nil {
				maxEarlyData, _ = strconv.Atoi(values.Get("ed"))
			}
		}
		hostHeader := firstParam(params, "host")
		if hostHeader == "" {
			hostHeader = host
		}
		transport := map[string]any{
			"type":    "ws",
			"path":    path,
			"headers": map[string]any{"Host": hostHeader},
		}
		if maxEarlyData > 0 {
			transport["max_early_data"] = maxEarlyData
			transport["early_data_header_name"] = "Sec-WebSocket-Protocol"
		}
		return transport

	case "grpc":
		return map[string]any{
			"type": "grpc",
			"service_name": firstParam(params,
				"serviceName", "service_name", "service-name", "grpc-service-name", "path"),
		}

	case "http":
		path := firstParam(params, "path")
		if path == "" {
			path = "/"
		}
		hostHeader := firstParam(params, "host")
		if hostHeader == "" {
			hostHeader = host
		}
		return map[string]any{
			"type": "http",
			"host": []string{hostHeader},
			"path": path,
		}

	case "httpupgrade":
		path := firstParam(params, "path")
		if path == "" {
			path = "/"
		}
		hostHeader := firstParam(params, "host")
		if hostHeader == "" {
			hostHeader = host
		}
		return map[string]any{
			"type": "httpupgrade",
			"host": hostHeader,
			"path": path,
		}

	case "quic":
		return map[string]any{"type": "quic"}
	}
	return nil
}

// applySNISpoof lets the user override the TLS server name globally.
func applySNISpoof(outbound Outbound, settings models.AppSettings) {
	if outbound == nil || !settings.SNISpoofEnabled {
		return
	}
	value := strings.TrimSpace(settings.SNISpoofValue)
	if value == "" {
		return
	}
	tlsOpts, ok := outbound["tls"].(map[string]any)
	if !ok {
		return
	}
	tlsOpts["server_name"] = value
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

func hostPort(u *url.URL, defaultPort int) (string, int, error) {
	host := u.Hostname()
	if host == "" {
		return "", 0, fmt.Errorf("link is missing the server host")
	}
	portText := u.Port()
	if portText == "" {
		if defaultPort == 0 {
			return "", 0, fmt.Errorf("link is missing the server port")
		}
		return host, defaultPort, nil
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 {
		return "", 0, fmt.Errorf("link has an invalid port %q", portText)
	}
	return host, port, nil
}

func firstParam(values url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(values.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func intParam(values url.Values, keys ...string) int {
	if raw := firstParam(values, keys...); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil {
			return value
		}
	}
	return 0
}

func boolParam(values url.Values, keys ...string) bool {
	switch strings.ToLower(firstParam(values, keys...)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func splitList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func setIfNotEmpty(values url.Values, key, value string) {
	if strings.TrimSpace(value) != "" {
		values.Set(key, value)
	}
}

func defaultInt(value, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	case bool:
		return strconv.FormatBool(typed)
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func intValue(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}
