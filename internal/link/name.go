package link

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
)

// DecodeProfileName undoes percent-encoding, including the double- and
// triple-encoding some providers apply to emoji labels.
func DecodeProfileName(input string) string {
	decoded := input
	for i := 0; i < 4; i++ {
		next, err := url.PathUnescape(decoded)
		if err != nil || next == decoded {
			break
		}
		decoded = next
	}
	return decoded
}

// DetectProtocol classifies a stored config_link for display and filtering.
func DetectProtocol(raw string) string {
	trimmed := strings.TrimSpace(raw)

	if strings.HasPrefix(trimmed, "proxies:") ||
		strings.HasPrefix(trimmed, "port:") ||
		strings.HasPrefix(trimmed, "mixed-port:") ||
		strings.HasPrefix(trimmed, "socks-port:") ||
		strings.HasPrefix(trimmed, "---") {
		return "clash-yaml"
	}

	if strings.HasPrefix(trimmed, "{") {
		var probe map[string]json.RawMessage
		if err := json.Unmarshal([]byte(trimmed), &probe); err == nil {
			if _, ok := probe["outbounds"]; ok {
				return "sing-box"
			}
			if _, ok := probe["type"]; ok {
				return "sing-box"
			}
		}
	}

	scheme, _, found := strings.Cut(trimmed, "://")
	if !found {
		return "unknown"
	}
	switch strings.ToLower(scheme) {
	case "vless":
		return "vless"
	case "vmess":
		return "vmess"
	case "trojan":
		return "trojan"
	case "ss":
		return "shadowsocks"
	case "ssr":
		return "shadowsocksr"
	case "hy2", "hysteria2":
		return "hysteria2"
	case "hy", "hysteria":
		return "hysteria"
	case "tuic":
		return "tuic"
	case "wg", "wireguard":
		return "wireguard"
	case "socks", "socks4", "socks5":
		return "socks"
	case "http", "https":
		return "http"
	case "ssh":
		return "ssh"
	case "anytls":
		return "anytls"
	case "rigby":
		return "rigby"
	default:
		return "unknown"
	}
}

// protocolDisplayName renders a scheme for auto-generated profile labels.
func protocolDisplayName(scheme string) string {
	switch strings.ToLower(scheme) {
	case "vless":
		return "VLESS"
	case "vmess":
		return "VMess"
	case "trojan":
		return "Trojan"
	case "ss":
		return "Shadowsocks"
	case "ssr":
		return "ShadowsocksR"
	case "hy", "hysteria":
		return "Hysteria"
	case "hy2", "hysteria2":
		return "Hysteria2"
	case "tuic":
		return "TUIC"
	case "rigby":
		return "Rigby"
	case "wg", "wireguard":
		return "WireGuard"
	case "socks", "socks4", "socks5":
		return "SOCKS"
	case "http", "https":
		return "HTTP"
	case "ssh":
		return "SSH"
	case "anytls":
		return "AnyTLS"
	default:
		return scheme
	}
}

// ExtractName derives a human label for a link, preferring the fragment.
func ExtractName(rawLink string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(rawLink, "&amp;", "&"))

	if name, ok := nameFromSingBoxJSON(trimmed); ok {
		return DecodeProfileName(name)
	}
	if name, ok := nameFromVMessLink(trimmed); ok {
		return DecodeProfileName(name)
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "Imported Profile"
	}

	if fragment := strings.TrimSpace(parsed.Fragment); fragment != "" {
		return DecodeProfileName(fragment)
	}
	if name := preferredLinkName(parsed.Query()); name != "" {
		return DecodeProfileName(name)
	}
	if host := parsed.Hostname(); host != "" {
		return host + " (" + protocolDisplayName(parsed.Scheme) + ")"
	}
	return "Imported Profile"
}

func preferredLinkName(values url.Values) string {
	for _, key := range []string{
		"serviceName", "service_name", "service-name",
		"remarks", "remark", "name", "ps", "tag",
	} {
		if value := strings.TrimSpace(values.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func nameFromVMessLink(rawLink string) (string, bool) {
	payload, ok := strings.CutPrefix(rawLink, "vmess://")
	if !ok {
		return "", false
	}
	decoded, err := decodeBase64(strings.TrimSpace(payload))
	if err != nil {
		return "", false
	}
	var config map[string]any
	if err := json.Unmarshal(decoded, &config); err != nil {
		return "", false
	}
	name := strings.TrimSpace(stringValue(config["ps"]))
	return name, name != ""
}

func nameFromSingBoxJSON(raw string) (string, bool) {
	if !strings.HasPrefix(raw, "{") {
		return "", false
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return "", false
	}
	outbound, err := selectSingBoxOutbound(root)
	if err != nil {
		return "", false
	}
	tag := strings.TrimSpace(stringValue(outbound["tag"]))
	return tag, tag != ""
}

// DecodeBase64 accepts every base64 flavour subscription providers use.
func DecodeBase64(payload string) ([]byte, error) { return decodeBase64(payload) }

// decodeBase64 accepts every base64 flavour subscription providers use.
func decodeBase64(payload string) ([]byte, error) {
	cleaned := strings.NewReplacer("\n", "", "\r", "", " ", "").Replace(payload)
	encodings := []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	}
	var lastErr error
	for _, encoding := range encodings {
		decoded, err := encoding.DecodeString(cleaned)
		if err == nil {
			return decoded, nil
		}
		lastErr = err
	}
	return nil, lastErr
}
