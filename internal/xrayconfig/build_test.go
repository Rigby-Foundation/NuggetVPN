package xrayconfig

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/Kage/internal/models"
	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/session"
	xcore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/features/routing"
	rsession "github.com/xtls/xray-core/features/routing/session"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

func testRequest() Request {
	profile := models.Profile{ID: "server", Name: "SOCKS", ConfigLink: "socks5://user:pass@203.0.113.1:1080"}
	return Request{Profile: profile, Profiles: []models.Profile{profile}, Settings: models.DefaultSettings(), DisableTUN: true}
}

func startRouter(t *testing.T, result Result) routing.Router {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal(result.JSON, &root); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "routing.lua")
	if err := os.WriteFile(path, []byte(result.Script), 0o600); err != nil {
		t.Fatal(err)
	}
	root["routing"] = map[string]any{"script": path}
	data, _ := json.Marshal(root)
	config, err := serial.LoadJSONConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	instance, err := xcore.New(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = instance.Close() })
	if err = instance.Start(); err != nil {
		t.Fatal(err)
	}
	return instance.GetFeature(routing.RouterType()).(routing.Router)
}

func TestNativeRoutingPreservesLogicalRulesAndInversion(t *testing.T) {
	request := testRequest()
	request.Settings.RoutingRules = []models.RoutingRule{
		{ID: "logical", Kind: models.SourceLogical, Mode: models.LogicalAnd, Action: models.ActionBlock, Conditions: []models.RoutingCondition{{Kind: models.SourceDomains, Values: []string{"blocked.example"}}, {Kind: models.SourcePort, Values: []string{"80-90"}}}},
		{ID: "inverted", Kind: models.SourceDomains, Invert: true, Values: []string{"allowed.example"}, Action: models.ActionDirect},
	}
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	router := startRouter(t, result)
	for _, test := range []struct {
		host           string
		port           uint16
		outbound, rule string
	}{
		{"blocked.example", 80, "block", "0"},
		{"blocked.example", 443, "direct", "1"},
		{"allowed.example", 443, "proxy", "2"},
	} {
		ctx := &rsession.Context{Inbound: &session.Inbound{Tag: MixedTag}, Outbound: &session.Outbound{Target: xnet.TCPDestination(xnet.DomainAddress(test.host), xnet.Port(test.port))}}
		route, err := router.PickRoute(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if route.GetOutboundTag() != test.outbound || route.GetRuleTag() != test.rule {
			t.Errorf("%s:%d => %s/%s, want %s/%s", test.host, test.port, route.GetOutboundTag(), route.GetRuleTag(), test.outbound, test.rule)
		}
	}
}

func TestConfigurationUsesOnlyNativeXray(t *testing.T) {
	request := testRequest()
	request.DisableTUN = false
	request.MixedPort = 10808
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Inbounds  []struct{ Protocol string }
		Outbounds []map[string]any
	}
	if err = json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Inbounds) != 2 || config.Inbounds[0].Protocol != "tun" || config.Inbounds[1].Protocol != "socks" {
		t.Fatalf("inbounds: %+v", config.Inbounds)
	}
	for _, outbound := range config.Outbounds {
		if _, old := outbound["type"]; old {
			t.Fatal("non-Xray outbound survived")
		}
	}
}

func TestUnavailableRuleListFailsInsteadOfBroadeningRouting(t *testing.T) {
	request := testRequest()
	request.Settings.RoutingRules = []models.RoutingRule{{ID: "block-list", Kind: models.SourceRuleSet, Values: []string{"https://example.com/block.srs"}, Action: models.ActionBlock}}
	if _, err := Build(request); err == nil {
		t.Fatal("a missing block list must not silently disappear")
	}
}

func TestNativeProtocolConfigurationsConstruct(t *testing.T) {
	for _, link := range []string{
		"vless://11111111-2222-3333-4444-555555555555@reality.example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=MRCLmc0aZOhWpNsFPMHqYVCbHrJMuwQ5tDcWbXqIxSs&sid=0123abcd&type=tcp&flow=xtls-rprx-vision",
		"vless://11111111-2222-3333-4444-555555555555@x.example.com:443?encryption=none&security=tls&type=xhttp&path=%2Fdl&host=cdn.example.com&mode=stream-one",
		"trojan://password@grpc.example.com:443?sni=grpc.example.com&type=grpc&serviceName=tg",
		"ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@ss.example.com:8388",
	} {
		t.Run(link[:strings.Index(link, ":")], func(t *testing.T) {
			request := testRequest()
			request.Profile.ConfigLink = link
			request.Settings.TLSFragment, request.Settings.TLSMixedSNICase = true, true
			result, err := Build(request)
			if err != nil {
				t.Fatal(err)
			}
			startRouter(t, result)
		})
	}
}

func TestNativeWildcardDoesNotBroadenToTheParentDomain(t *testing.T) {
	request := testRequest()
	request.Settings.RoutingRules = []models.RoutingRule{{ID: "subdomains", Kind: models.SourceDomains, Values: []string{"*.example.com"}, Action: models.ActionBlock}}
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	router := startRouter(t, result)
	for host, want := range map[string]string{"example.com": ExitTag, "child.example.com": "block"} {
		ctx := &rsession.Context{Outbound: &session.Outbound{Target: xnet.TCPDestination(xnet.DomainAddress(host), 443)}}
		route, err := router.PickRoute(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if route.GetOutboundTag() != want {
			t.Errorf("%s went to %s, want %s", host, route.GetOutboundTag(), want)
		}
	}
}

func TestNativeDNSRoutingDoesNotLoopIntoItself(t *testing.T) {
	result, err := Build(testRequest())
	if err != nil {
		t.Fatal(err)
	}
	router := startRouter(t, result)
	for inbound, want := range map[string]string{"dns-bootstrap": DirectTag, "dns-query": ExitTag, TunTag: "dns-out"} {
		ctx := &rsession.Context{Inbound: &session.Inbound{Tag: inbound}, Outbound: &session.Outbound{Target: xnet.UDPDestination(xnet.IPAddress([]byte{1, 1, 1, 1}), 53)}}
		route, err := router.PickRoute(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if route.GetOutboundTag() != want {
			t.Errorf("%s went to %s, want %s", inbound, route.GetOutboundTag(), want)
		}
	}
}

func TestNativeKillSwitchStartsWithoutAnyProxyEngine(t *testing.T) {
	result, err := Lockdown(models.DefaultSettings(), "")
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	_ = json.Unmarshal(result.JSON, &config)
	delete(config, "inbounds")
	result.JSON, _ = json.Marshal(config)
	router := startRouter(t, result)
	ctx := &rsession.Context{Outbound: &session.Outbound{Target: xnet.TCPDestination(xnet.IPAddress([]byte{203, 0, 113, 22}), 443)}}
	route, err := router.PickRoute(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if route.GetOutboundTag() != "drop" {
		t.Fatal("kill switch allowed internet traffic")
	}
}
