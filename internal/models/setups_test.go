package models

import "testing"

func TestSetupsSwitchKeepsEachGraph(t *testing.T) {
	settings := DefaultSettings()
	settings.RoutingRules = []RoutingRule{{ID: "home", Kind: SourceDomains, Values: []string{"a.example"}, Action: ActionDirect}}
	settings.Normalize()
	if len(settings.RoutingSetups) != 1 || settings.ActiveRoutingSetup != DefaultSetupID {
		t.Fatalf("existing routing should become the first setup: %+v", settings.RoutingSetups)
	}

	settings.RoutingSetups = append(settings.RoutingSetups, RoutingSetup{ID: "work", Name: "Work", Graph: RoutingGraph{DefaultAction: ActionDirect}})
	settings.Normalize()
	if !settings.SwitchSetup("work") {
		t.Fatal("switch refused")
	}
	if len(settings.RoutingRules) != 0 || settings.DefaultAction != ActionDirect {
		t.Errorf("work setup not loaded: %+v", settings.RoutingRules)
	}
	if !settings.SwitchSetup(DefaultSetupID) || len(settings.RoutingRules) != 1 || settings.RoutingRules[0].ID != "home" {
		t.Errorf("the first setup's graph was lost: %+v", settings.RoutingRules)
	}
	if settings.SwitchSetup("nope") {
		t.Error("switching to a setup that does not exist should fail")
	}
}

func TestParseDNSServer(t *testing.T) {
	for input, want := range map[string]DNSServer{
		"1.1.1.1":                      {Type: "udp", Server: "1.1.1.1", Port: 53},
		"8.8.8.8:5353":                 {Type: "udp", Server: "8.8.8.8", Port: 5353},
		"tls://one.one.one.one":        {Type: "tls", Server: "one.one.one.one", Port: 853},
		"https://dns.google/dns-query": {Type: "https", Server: "dns.google", Port: 443, Path: "/dns-query"},
		"https://1.1.1.1":              {Type: "https", Server: "1.1.1.1", Port: 443, Path: "/dns-query"},
		"h3://dns.example/q":           {Type: "h3", Server: "dns.example", Port: 443, Path: "/q"},
		"quic://dns.adguard-dns.com":   {Type: "quic", Server: "dns.adguard-dns.com", Port: 853},
		"local":                        {Type: "local"},
	} {
		got, ok := ParseDNSServer(input)
		if !ok || got != want {
			t.Errorf("ParseDNSServer(%q) = %+v, %v; want %+v", input, got, ok, want)
		}
	}
	for _, bad := range []string{"", "ftp://x.example", "dnsserver", "1.1.1.1:99999", "udp://1.1.1.1/path"} {
		if _, ok := ParseDNSServer(bad); ok {
			t.Errorf("ParseDNSServer(%q) should fail", bad)
		}
	}
}
