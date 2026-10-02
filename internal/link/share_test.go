package link

import (
	"encoding/base64"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// A server written out as a link must parse back into the same server.
func TestEncodeShareLinkRoundTrips(t *testing.T) {
	links := []string{
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=PUBKEY&sid=ab12&type=tcp#Reality",
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls&sni=cdn.example.com&type=ws&path=%2Fws%3Fed%3D2048&host=cdn.example.com#WS",
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls&type=grpc&serviceName=svc#gRPC",
		"vless://11111111-2222-3333-4444-555555555555@example.com:443?security=tls&type=xhttp&path=%2Fx&host=h.example.com&mode=packet-up#XHTTP",
		"trojan://secret@example.com:443?sni=example.com&alpn=h2,http/1.1#Trojan",
		"ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@example.com:8388#SS",
		"hysteria2://pass@example.com:443/?sni=example.com&obfs=salamander&obfs-password=x&insecure=1#Hy2",
		"tuic://uuid-value:pw@example.com:443?sni=example.com&congestion_control=bbr&udp_relay_mode=native#TUIC",
		"vmess://" + vmessPayload(t),
	}
	for _, original := range links {
		want, err := ParseOutbound(original, models.AppSettings{})
		if err != nil {
			t.Fatalf("parse %s: %v", original, err)
		}
		encoded, err := EncodeShareLink(want, "name")
		if err != nil {
			t.Fatalf("encode %s: %v", original, err)
		}
		got, err := ParseOutbound(encoded, models.AppSettings{})
		if err != nil {
			t.Fatalf("parse encoded %s: %v", encoded, err)
		}
		if !reflect.DeepEqual(normalize(t, want), normalize(t, got)) {
			t.Errorf("round trip changed the server\n link: %s\n  out: %s\n want: %v\n  got: %v", original, encoded, want, got)
		}
	}
}

func vmessPayload(t *testing.T) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{
		"v": "2", "ps": "VMess", "add": "example.com", "port": "443", "id": "11111111-2222-3333-4444-555555555555",
		"aid": "0", "scy": "auto", "net": "ws", "host": "example.com", "path": "/v", "tls": "tls", "sni": "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(encoded)
}

// normalize compares through JSON, so []string and []any agree.
func normalize(t *testing.T, value any) any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

// Every server in an Xray config comes out as its own link.
func TestShareLinksFromXrayConfig(t *testing.T) {
	config := `{
	  "inbounds": [{"port": 10808, "protocol": "socks"}],
	  "outbounds": [
	    {"tag": "nl", "protocol": "vless",
	     "settings": {"vnext": [{"address": "nl.example.com", "port": 443, "users": [{"id": "uuid-1", "flow": "xtls-rprx-vision", "encryption": "none"}]}]},
	     "streamSettings": {"network": "tcp", "security": "reality",
	       "realitySettings": {"serverName": "www.microsoft.com", "publicKey": "PBK", "shortId": "01", "fingerprint": "chrome"}}},
	    {"tag": "de", "protocol": "trojan",
	     "settings": {"servers": [{"address": "de.example.com", "port": 443, "password": "pw"}]},
	     "streamSettings": {"network": "ws", "security": "tls", "tlsSettings": {"serverName": "de.example.com"}, "wsSettings": {"path": "/t", "headers": {"Host": "de.example.com"}}}},
	    {"tag": "direct", "protocol": "freedom", "settings": {}}
	  ]
	}`
	links, err := ShareLinks(config, "Config")
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 {
		t.Fatalf("got %d links, want 2: %v", len(links), links)
	}
	if links[0].Name != "nl" || !strings.HasPrefix(links[0].Link, "vless://uuid-1@nl.example.com:443?") {
		t.Errorf("first link: %+v", links[0])
	}
	parsed, err := ParseOutbound(links[0].Link, models.AppSettings{})
	if err != nil {
		t.Fatal(err)
	}
	reality := parsed["tls"].(map[string]any)["reality"].(map[string]any)
	if reality["public_key"] != "PBK" || parsed["flow"] != "xtls-rprx-vision" {
		t.Errorf("reality settings lost: %v", parsed)
	}
	if !strings.HasPrefix(links[1].Link, "trojan://pw@de.example.com:443?") || !strings.Contains(links[1].Link, "type=ws") {
		t.Errorf("second link: %+v", links[1])
	}
}

// A profile imported from a link shares that link untouched.
func TestShareLinksKeepsTheOriginalLink(t *testing.T) {
	original := "vless://id@example.com:443?security=tls&custom=kept#Mine"
	links, err := ShareLinks(original, "Mine")
	if err != nil || len(links) != 1 || links[0].Link != original {
		t.Fatalf("got %v, %v", links, err)
	}
}
