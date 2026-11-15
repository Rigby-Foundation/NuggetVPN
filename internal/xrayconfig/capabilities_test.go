package xrayconfig

import (
	"bytes"
	"encoding/json"
	"github.com/xtls/xray-core/infra/conf/serial"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

func TestUnsupportedSavedRulesCannotDisappearOrBroaden(t *testing.T) {
	for _, condition := range []models.RoutingCondition{
		{Kind: models.SourceProtocol, Values: []string{"dns"}},
		{Kind: models.SourceProtocol, Values: []string{"tls", "stun"}},
		{Kind: models.SourceRuleSet, Values: []string{"https://example.com/list.srs"}},
	} {
		for _, logical := range []bool{false, true} {
			request := testRequest()
			rule := models.RoutingRule{ID: "legacy", Kind: condition.Kind, Values: condition.Values, Invert: true, Action: models.ActionBlock}
			if logical {
				rule.Kind, rule.Mode, rule.Conditions = models.SourceLogical, models.LogicalAnd, []models.RoutingCondition{condition, {Kind: models.SourcePort, Values: []string{"443"}}}
			}
			request.Settings.RoutingRules = []models.RoutingRule{rule}
			if _, err := Build(request); err == nil || !strings.Contains(err.Error(), "legacy") {
				t.Fatalf("unsupported rule was silently changed: %+v, err=%v", rule, err)
			}
		}
	}
}

func TestSupportedDNSResolversConstructInNativeXray(t *testing.T) {
	for _, resolver := range []string{"1.1.1.1", "tcp://1.1.1.1:53", "https://1.1.1.1/dns-query"} {
		request := testRequest()
		request.Settings.DNS = resolver
		request.Settings.RoutingRules = []models.RoutingRule{{ID: "domain", Kind: models.SourceDomains, Values: []string{"example.com"}, Action: models.ActionProxy, DNS: resolver}}
		result, err := Build(request)
		if err != nil {
			t.Fatal(err)
		}
		startRouter(t, result)
	}
}

func TestHysteria2OptionsReachNativeXray(t *testing.T) {
	request := testRequest()
	request.Profile.ConfigLink = "hysteria2://secret@203.0.113.1:443?sni=example.com&obfs=salamander&obfs-password=secret&mport=20000-20100&upmbps=10&downmbps=20"
	if err := Check(request.Profile, request.Settings); err != nil {
		t.Fatal(err)
	}
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	var root struct{ Outbounds []map[string]any }
	if err := json.Unmarshal(result.JSON, &root); err != nil {
		t.Fatal(err)
	}
	outbound := root.Outbounds[0]
	if outbound["protocol"] != "hysteria" {
		t.Fatalf("not a native Hysteria outbound: %v", outbound["protocol"])
	}
	stream := outbound["streamSettings"].(map[string]any)
	mask := stream["finalmask"].(map[string]any)
	if len(mask["udp"].([]any)) != 2 || mask["quicParams"] == nil {
		t.Fatal("obfuscation, port hopping or bandwidth options were lost")
	}
	startRouter(t, result)
}

func TestUnsupportedProfilesAreRejectedBeforeTheyAreOffered(t *testing.T) {
	for _, value := range []string{
		"tuic://11111111-2222-3333-4444-555555555555:secret@203.0.113.1:443",
		"ssh://user:secret@203.0.113.1:22",
		"hysteria://203.0.113.1:443?auth=secret",
		"socks4://203.0.113.1:1080",
		"vless://11111111-2222-3333-4444-555555555555@203.0.113.1:443?type=http&security=tls",
		"vless://11111111-2222-3333-4444-555555555555@203.0.113.1:443?type=unknown",
		"vless://11111111-2222-3333-4444-555555555555@203.0.113.1:443?type=xhttp&mode=typo",
		"ss://YWVzLTEyOC1jZmI6c2VjcmV0@203.0.113.1:8388",
	} {
		if err := Check(models.Profile{ConfigLink: value}, models.DefaultSettings()); err == nil {
			t.Errorf("unusable configuration was accepted: %s", value)
		}
	}
}

func TestNativeExportPreservesTransportsAndRejectsPartialOutput(t *testing.T) {
	profiles := []models.Profile{
		{Name: "same", ConfigLink: "hysteria2://secret@203.0.113.1:443?sni=example.com&obfs=salamander&obfs-password=secret"},
		{Name: "same", ConfigLink: "vless://11111111-2222-3333-4444-555555555555@203.0.113.1:443?security=tls&type=xhttp&extra=%7B%22xPaddingBytes%22%3A%22100-200%22%7D"},
	}
	for _, full := range []bool{false, true} {
		data, err := Export(profiles, models.DefaultSettings(), full)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(data, "xPaddingBytes") || !strings.Contains(data, "salamander") || !strings.Contains(data, "same (2)") {
			t.Fatal("export lost options or duplicated tags")
		}
		if _, err := serial.LoadJSONConfig(bytes.NewReader([]byte(data))); err != nil {
			t.Fatal(err)
		}
	}
	profiles = append(profiles, models.Profile{Name: "unsupported", ConfigLink: "ssh://user:secret@203.0.113.1:22"})
	if _, err := Export(profiles, models.DefaultSettings(), true); err == nil {
		t.Fatal("unsupported profile disappeared from export")
	}
}
