package link

import (
	"strings"
	"testing"
)

// Remnawave serves Happ 4 a JSON array of whole Xray configs: a separator,
// a balancing "auto" entry, a plain server and Xray's own hysteria.
const xrayArray = `[
 {"remarks": "⬇️ —WiFi — ⬇️", "outbounds": [
   {"protocol": "shadowsocks", "tag": "proxy", "settings": {"servers": [{"address": "127.0.0.1", "port": 80, "method": "aes-256-gcm", "password": "password"}]}},
   {"protocol": "freedom", "tag": "direct"}]},
 {"remarks": "Auto", "outbounds": [
   {"protocol": "vless", "tag": "proxy-1", "settings": {"vnext": [{"address": "1.1.1.1", "port": 443, "users": [{"id": "11111111-1111-1111-1111-111111111111", "encryption": "none"}]}]}},
   {"protocol": "vless", "tag": "proxy-2", "settings": {"vnext": [{"address": "2.2.2.2", "port": 443, "users": [{"id": "22222222-2222-2222-2222-222222222222", "encryption": "none"}]}]}},
   {"protocol": "freedom", "tag": "direct"}],
  "routing": {"balancers": [{"tag": "auto", "selector": ["proxy-"], "fallbackTag": "proxy-2"}]}},
 {"remarks": "Germany", "outbounds": [
   {"protocol": "vless", "tag": "proxy", "settings": {"vnext": [{"address": "de.example.com", "port": 2053, "users": [{"id": "33333333-3333-3333-3333-333333333333", "encryption": "none", "flow": "xtls-rprx-vision"}]}]},
    "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {"serverName": "de.example.com", "publicKey": "GDlgvx8exl9BJ5dD2HSVqE2oUbZyZZOFX5EdnCn5j2M", "shortId": "283f", "fingerprint": "firefox"}}}]},
 {"remarks": "Germany ⚡", "outbounds": [
   {"protocol": "hysteria", "tag": "proxy", "settings": {"address": "de.example.com", "port": 8443, "version": 2},
    "streamSettings": {"network": "hysteria", "security": "tls", "hysteriaSettings": {"auth": "secret-auth", "version": 2}, "tlsSettings": {"serverName": "de.example.com", "alpn": ["h3"]}}}]}
]`

func TestXrayConfigsAsLinks(t *testing.T) {
	text, ok := XrayConfigsAsLinks(xrayArray)
	if !ok {
		t.Fatal("not read as an Xray config array")
	}
	lines := strings.Split(text, "\n")
	if len(lines) != 4 {
		t.Fatalf("got %d links, want 4:\n%s", len(lines), text)
	}
	checks := []struct{ scheme, host, name string }{
		{"ss://", "@127.0.0.1:80", "WiFi"},
		{"vless://", "@2.2.2.2:443", "Auto"}, // the balancer's fallback
		{"vless://", "@de.example.com:2053", "Germany"},
		{"hysteria2://secret-auth@", "de.example.com:8443", "Germany"},
	}
	for index, check := range checks {
		line := lines[index]
		if !strings.HasPrefix(line, check.scheme) || !strings.Contains(line, check.host) || ExtractName(line) == "" ||
			!strings.Contains(ExtractName(line), check.name) {
			t.Errorf("link %d = %s, want %s…%s named %q", index, line, check.scheme, check.host, check.name)
		}
	}
	if _, ok := XrayConfigsAsLinks("vless://x@1.1.1.1:443#a"); ok {
		t.Error("a link list was read as JSON")
	}
}
