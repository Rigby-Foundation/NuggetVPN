package xray

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	xraycore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

var profiles = []models.Profile{
	{ID: "reality", Name: "Reality", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@reality.example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs&sid=0123abcd&type=tcp&flow=xtls-rprx-vision#R"},
	{ID: "ws", Name: "WS", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@ws.example.com:443?encryption=none&security=tls&sni=ws.example.com&type=ws&path=%2Fws%3Fed%3D2048&host=ws.example.com#WS"},
	{ID: "grpc", Name: "gRPC", ConfigLink: "trojan://password@grpc.example.com:443?sni=grpc.example.com&type=grpc&serviceName=tg#G"},
	{ID: "xhttp", Name: "XHTTP", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@x.example.com:443?encryption=none&security=tls&type=xhttp&path=%2Fdl&host=cdn.example.com&mode=stream-one#X"},
	{ID: "vmess", Name: "VMess", ConfigLink: "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MiLCJhZGQiOiJ2bS5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NSIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiJ2bS5leGFtcGxlLmNvbSIsInBhdGgiOiIvd3MiLCJ0bHMiOiJ0bHMiLCJzbmkiOiJ2bS5leGFtcGxlLmNvbSJ9"},
	{ID: "ss", Name: "SS", ConfigLink: "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@ss.example.com:8388#SS"},
	{ID: "xhttp-extra", Name: "XHTTP extra", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@xe.example.com:443?encryption=none&type=xhttp&path=%2Fapi%2F&host=xe.example.com&mode=packet-up&security=tls&sni=xe.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1&extra=%7B%22xmux%22%3A%7B%22cMaxLifetimeMs%22%3A0%2C%22cMaxReuseTimes%22%3A%2236-96%22%2C%22maxConcurrency%22%3A%228-32%22%2C%22maxConnections%22%3A0%2C%22hMaxRequestTimes%22%3A%22320-640%22%2C%22hMaxReusableSecs%22%3A%22720-1800%22%7D%2C%22uplinkDataKey%22%3A%22X-Data%22%2C%22uplinkChunkSize%22%3A3072%2C%22uplinkHTTPMethod%22%3A%22GET%22%2C%22uplinkDataPlacement%22%3A%22header%22%2C%22downloadSettings%22%3A%7B%22address%22%3A%22down.example.com%22%2C%22port%22%3A443%2C%22network%22%3A%22xhttp%22%2C%22security%22%3A%22tls%22%2C%22tlsSettings%22%3A%7B%22serverName%22%3A%22down.example.com%22%2C%22alpn%22%3A%5B%22h2%22%5D%7D%2C%22xhttpSettings%22%3A%7B%22path%22%3A%22%2Fdown%22%7D%7D%7D#XE"},
	{ID: "socks", Name: "SOCKS", ConfigLink: "socks5://user:pass@203.0.113.9:1080#S"},
}

func TestEngineBuildsEveryProtocol(t *testing.T) {
	chain := []models.Profile{{ID: "hop", Name: "Hop", ConfigLink: "trojan://pw@hop.example.com:443?sni=hop.example.com#H"}}
	engine, err := New(models.DefaultSettings(), chain)
	if err != nil {
		t.Fatal(err)
	}
	for _, profile := range profiles {
		dial, err := engine.Dial(profile)
		if err != nil {
			t.Fatalf("%s: %v", profile.Name, err)
		}
		if dial["type"] != "socks" || dial["server"] != "127.0.0.1" || dial["username"] == "" {
			t.Errorf("%s: dial %v", profile.Name, dial)
		}
	}
	// A second ask for the same server reuses its entry point.
	again, _ := engine.Dial(profiles[0])
	first, _ := engine.Dial(profiles[0])
	if again["server_port"] != first["server_port"] {
		t.Error("the same server got two entry points")
	}
	if _, err := engine.Dial(models.Profile{Name: "HY2", ConfigLink: "hy2://pw@h.example.com:443#H"}); err == nil ||
		!strings.Contains(err.Error(), "built-in core") {
		t.Errorf("an unsupported protocol should say to use the built-in core: %v", err)
	}
	domains := strings.Join(engine.ServerDomains(), ",")
	for _, want := range []string{"reality.example.com", "hop.example.com", "ss.example.com"} {
		if !strings.Contains(domains, want) {
			t.Errorf("server domain %s missing: %s", want, domains)
		}
	}

	config, err := engine.Config()
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(config, &parsed); err != nil {
		t.Fatal(err)
	}
	// Every server is reached through the chain, and the chain through the
	// built-in core's bypass.
	port, user, _ := engine.Bypass()
	for _, outbound := range parsed["outbounds"].([]any) {
		entry := outbound.(map[string]any)
		tag := entry["tag"].(string)
		stream, _ := entry["streamSettings"].(map[string]any)
		sockopt, _ := stream["sockopt"].(map[string]any)
		switch {
		case strings.HasPrefix(tag, "server-") && sockopt["dialerProxy"] != "hop-1":
			t.Errorf("%s does not go through the chain: %v", tag, stream)
		case tag == "hop-1" && sockopt["dialerProxy"] != bypassTag:
			t.Errorf("the chain does not leave through the bypass: %v", stream)
		case tag == bypassTag:
			server := entry["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
			users := server["users"].([]any)[0].(map[string]any)
			if int(server["port"].(float64)) != port || users["user"] != user {
				t.Errorf("bypass outbound does not match the entry point: %v", entry)
			}
		}
	}

	// XHTTP's finer settings reach Xray, the downlink as a stream of its own.
	var xhttpExtra map[string]any
	for _, outbound := range parsed["outbounds"].([]any) {
		stream, _ := outbound.(map[string]any)["streamSettings"].(map[string]any)
		settings, _ := stream["xhttpSettings"].(map[string]any)
		if extra, _ := settings["extra"].(map[string]any); extra["uplinkDataPlacement"] != nil {
			xhttpExtra = extra
		}
	}
	if xhttpExtra == nil || xhttpExtra["uplinkHTTPMethod"] != "GET" {
		t.Errorf("XHTTP extra settings did not reach Xray: %v", xhttpExtra)
	} else if download, _ := xhttpExtra["downloadSettings"].(map[string]any); download["address"] != "down.example.com" || download["network"] != "xhttp" {
		t.Errorf("XHTTP downlink: %v", download)
	}

	// Xray's own loader, which is linked in.
	loaded, err := serial.LoadJSONConfig(bytes.NewReader(config))
	if err != nil {
		t.Fatalf("Xray rejected the config: %v\n%s", err, config)
	}
	instance, err := xraycore.New(loaded)
	if err != nil {
		t.Fatalf("Xray could not construct the config: %v\n%s", err, config)
	}
	_ = instance.Close()
}
