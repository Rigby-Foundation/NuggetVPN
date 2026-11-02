package core

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestSanitizeSingBox(t *testing.T) {
	config := `{
		"log": {"output": "/etc/periodic/daily/x", "level": "info"},
		"services": [{"type": "derp", "config_path": "/etc/derp.key"}],
		"inbounds": [
			{"type": "tun", "tag": "tun-in"},
			{"type": "mixed", "listen": "0.0.0.0", "listen_port": 1080},
			{"type": "socks", "listen_port": 1081},
			{"type": "socks", "listen": "127.0.0.1", "listen_port": 1082}
		],
		"endpoints": [{"type": "tailscale", "state_directory": "/Library/LaunchDaemons"}],
		"experimental": {
			"cache_file": {"enabled": true, "path": "/etc/cache.db"},
			"clash_api": {"external_controller": "0.0.0.0:9090", "external_ui": "/Library", "external_ui_download_url": "https://x"},
			"v2ray_api": {"listen": "0.0.0.0:1"}
		},
		"route": {"rules": [{"action": "route", "outbound": "direct", "port": 9007199254740993}]}
	}`
	out, err := sanitizeSingBox([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	for _, gone := range []string{"/etc/periodic", "derp", "0.0.0.0", "/Library", "external_ui", "v2ray_api", "state_directory", "/etc/cache.db"} {
		if strings.Contains(text, gone) {
			t.Errorf("%q survived: %s", gone, text)
		}
	}
	// Large integers are kept exactly.
	if !strings.Contains(text, "9007199254740993") {
		t.Errorf("a large number was rounded: %s", text)
	}

	var root struct {
		Inbounds []map[string]any `json:"inbounds"`
	}
	_ = json.Unmarshal(out, &root)
	if _, has := root.Inbounds[0]["listen"]; has {
		t.Error("the tunnel was given a listen address")
	}
	for _, inbound := range root.Inbounds[1:] {
		if inbound["listen"] != "127.0.0.1" {
			t.Errorf("inbound listens on %v", inbound["listen"])
		}
	}
}

func TestSanitizeMihomo(t *testing.T) {
	config := "mixed-port: 7890\nallow-lan: true\nexternal-controller: 0.0.0.0:9090\nlisteners:\n  - {name: x, type: socks, listen: 0.0.0.0, port: 1080}\nproxies: []\n"
	out, err := sanitizeMihomo([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	if err := yaml.Unmarshal(out, &root); err != nil {
		t.Fatal(err)
	}
	if root["allow-lan"] != false || root["listeners"] != nil || root["external-controller"] != nil {
		t.Errorf("config = %v", root)
	}
	if root["mixed-port"] != 7890 {
		t.Errorf("mixed-port = %v", root["mixed-port"])
	}
}

func TestSanitizeXray(t *testing.T) {
	config := `{"log":{"access":"/etc/x","loglevel":"warning"},"api":{"listen":"0.0.0.0:1"},"inbounds":[{"port":1,"protocol":"socks"}]}`
	out, err := sanitizeXray([]byte(config))
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	if strings.Contains(text, "/etc/x") || strings.Contains(text, `"api"`) || !strings.Contains(text, `"listen":"127.0.0.1"`) {
		t.Errorf("config = %s", text)
	}
}
