package link

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func sampleProfiles() []models.Profile {
	return []models.Profile{
		{
			ID:         "p1",
			Name:       "Test VLESS Reality",
			Protocol:   "vless",
			ConfigLink: "vless://d4b6a4a4-56b9-4a0e-bb36-69eb8b5d3888@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=yahoo.com&fp=chrome&pbk=1234567890abcdef1234567890abcdef1234567890a&sid=12345678#Test%20VLESS%20Reality",
		},
		{
			ID:         "p2",
			Name:       "Test Trojan WS",
			Protocol:   "trojan",
			ConfigLink: "trojan://password123@trojan.example.com:443?security=tls&sni=trojan.example.com&type=ws&path=%2Ftrojan-ws#Test%20Trojan%20WS",
		},
		{
			ID:         "p3",
			Name:       "Test Shadowsocks",
			Protocol:   "shadowsocks",
			ConfigLink: "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@ss.example.com:8388#Test%20Shadowsocks",
		},
		{
			ID:         "p4",
			Name:       "Test Hysteria2",
			Protocol:   "hysteria2",
			ConfigLink: "hysteria2://password123@hy2.example.com:443/?sni=hy2.example.com#Test%20Hysteria2",
		},
	}
}

func TestExportSingBox(t *testing.T) {
	profiles := sampleProfiles()
	settings := models.AppSettings{}

	// Test full sing-box config
	fullJSON, err := Export(profiles, settings, "singbox", true)
	if err != nil {
		t.Fatalf("Export singbox full failed: %v", err)
	}

	var root map[string]any
	if err := json.Unmarshal([]byte(fullJSON), &root); err != nil {
		t.Fatalf("Invalid singbox JSON output: %v", err)
	}

	outbounds, ok := root["outbounds"].([]any)
	if !ok || len(outbounds) < len(profiles) {
		t.Fatalf("Expected at least %d outbounds, got %v", len(profiles), len(outbounds))
	}

	// Test raw outbounds
	rawJSON, err := Export(profiles, settings, "singbox", false)
	if err != nil {
		t.Fatalf("Export singbox raw failed: %v", err)
	}
	var rawRoot map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &rawRoot); err != nil {
		t.Fatalf("Invalid singbox raw JSON output: %v", err)
	}
	if len(rawRoot["outbounds"].([]any)) != len(profiles) {
		t.Fatalf("Expected %d outbounds, got %d", len(profiles), len(rawRoot["outbounds"].([]any)))
	}
}

func TestExportClash(t *testing.T) {
	profiles := sampleProfiles()
	settings := models.AppSettings{}

	// Test full Clash config
	fullYAML, err := Export(profiles, settings, "clash", true)
	if err != nil {
		t.Fatalf("Export clash full failed: %v", err)
	}

	var root map[string]any
	if err := yaml.Unmarshal([]byte(fullYAML), &root); err != nil {
		t.Fatalf("Invalid clash YAML output: %v", err)
	}

	proxies, ok := root["proxies"].([]any)
	if !ok || len(proxies) != len(profiles) {
		t.Fatalf("Expected %d proxies, got %d", len(profiles), len(proxies))
	}

	proxyGroups, ok := root["proxy-groups"].([]any)
	if !ok || len(proxyGroups) == 0 {
		t.Fatalf("Expected proxy-groups in full Clash config")
	}

	// Test raw proxies
	rawYAML, err := Export(profiles, settings, "clash", false)
	if err != nil {
		t.Fatalf("Export clash raw failed: %v", err)
	}
	var rawRoot map[string]any
	if err := yaml.Unmarshal([]byte(rawYAML), &rawRoot); err != nil {
		t.Fatalf("Invalid clash raw YAML: %v", err)
	}
	if len(rawRoot["proxies"].([]any)) != len(profiles) {
		t.Fatalf("Expected %d raw proxies, got %d", len(profiles), len(rawRoot["proxies"].([]any)))
	}
}

func TestExportXray(t *testing.T) {
	profiles := sampleProfiles()
	settings := models.AppSettings{}

	// Test full Xray config
	fullJSON, err := Export(profiles, settings, "xray", true)
	if err != nil {
		t.Fatalf("Export xray full failed: %v", err)
	}

	var root map[string]any
	if err := json.Unmarshal([]byte(fullJSON), &root); err != nil {
		t.Fatalf("Invalid xray JSON output: %v", err)
	}

	outbounds, ok := root["outbounds"].([]any)
	if !ok || len(outbounds) < 3 {
		t.Fatalf("Expected outbounds in Xray full config, got %v", outbounds)
	}

	// Check routing
	routing, ok := root["routing"].(map[string]any)
	if !ok || routing["rules"] == nil {
		t.Fatalf("Expected routing rules in full Xray config")
	}

	// Test raw outbounds
	rawJSON, err := Export(profiles, settings, "xray", false)
	if err != nil {
		t.Fatalf("Export xray raw failed: %v", err)
	}
	var rawRoot map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &rawRoot); err != nil {
		t.Fatalf("Invalid xray raw JSON: %v", err)
	}
	if len(rawRoot["outbounds"].([]any)) == 0 {
		t.Fatalf("Expected outbounds in raw Xray export")
	}
}

func TestExportTagDeduplication(t *testing.T) {
	profiles := []models.Profile{
		{
			ID:         "p1",
			Name:       "Server",
			Protocol:   "shadowsocks",
			ConfigLink: "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@ss1.example.com:8388#Server",
		},
		{
			ID:         "p2",
			Name:       "Server",
			Protocol:   "shadowsocks",
			ConfigLink: "ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@ss2.example.com:8388#Server",
		},
	}
	settings := models.AppSettings{}

	jsonStr, err := Export(profiles, settings, "singbox", false)
	if err != nil {
		t.Fatalf("Export failed: %v", err)
	}

	if !strings.Contains(jsonStr, `"Server"`) || !strings.Contains(jsonStr, `"Server (2)"`) {
		t.Fatalf("Expected tags to be deduplicated, got: %s", jsonStr)
	}
}
