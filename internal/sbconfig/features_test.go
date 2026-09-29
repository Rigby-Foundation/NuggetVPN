package sbconfig

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	box "github.com/sagernet/sing-box"
	"github.com/sagernet/sing-box/include"
	"github.com/sagernet/sing-box/option"
	sbjson "github.com/sagernet/sing/common/json"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

const (
	mainLink  = "trojan://password@main.example.com:443?sni=main.example.com&type=tcp#Main"
	otherLink = "trojan://password@jp.example.com:443?sni=jp.example.com&type=tcp#Japan"
)

// featureRequest is a graph using everything a rule can do.
func featureRequest(t *testing.T) Request {
	t.Helper()
	listDir := t.TempDir()
	listPath := filepath.Join(listDir, "list.json")
	domainsPath := filepath.Join(listDir, "list-domains.json")
	for _, path := range []string{listPath, domainsPath} {
		if err := os.WriteFile(path, []byte(`{"version":3,"rules":[{"domain_suffix":[".blocked.example"]}]}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	settings := models.DefaultSettings()
	settings.DefaultAction = models.ActionDirect
	settings.RoutingRules = []models.RoutingRule{
		{
			ID: "combo", Kind: models.SourceLogical, Mode: models.LogicalAnd, Action: models.ActionDirect,
			Conditions: []models.RoutingCondition{
				{Kind: models.SourceApps, Values: []string{"Telegram.exe"}},
				{Kind: models.SourceNetwork, Values: []string{"udp"}},
			},
		},
		{
			ID: "except", Kind: models.SourceLogical, Mode: models.LogicalOr, Action: models.ActionProxy,
			Conditions: []models.RoutingCondition{
				{Kind: models.SourceGeoSite, Values: []string{"google"}},
				{Kind: models.SourceGeoSite, Values: []string{"youtube"}, Invert: true},
			},
		},
		{ID: "udp", Kind: models.SourceNetwork, Values: []string{"UDP"}, Action: models.ActionDrop},
		{ID: "not-browsers", Kind: models.SourceApps, Values: []string{"firefox.exe"}, Invert: true, Action: models.ActionBlock},
		{ID: "stream", Kind: models.SourceDomains, Values: []string{"netflix.com"}, Action: models.ActionProxy, Server: "jp", DNS: "https://dns.google/dns-query"},
		{ID: "local", Kind: models.SourceDomains, Values: []string{"bank.example"}, Action: models.ActionDirect, DNS: "local"},
		{ID: "lists", Kind: models.SourceRuleSet, Values: []string{"https://lists.example/blocked.lst", "https://lists.example/ads.srs"}, Action: models.ActionProxy, DNS: "tls://1.1.1.1"},
		{ID: "torrent", Kind: models.SourceProtocol, Values: []string{"bittorrent"}, Action: models.ActionDirect},
	}
	settings.Normalize()

	return Request{
		Profile: models.Profile{ID: "main", Name: "Main", ConfigLink: mainLink},
		Profiles: []models.Profile{
			{ID: "main", Name: "Main", ConfigLink: mainLink},
			{ID: "jp", Name: "Japan", ConfigLink: otherLink},
		},
		Settings:  settings,
		RuleLists: map[string]RuleList{"https://lists.example/blocked.lst": {Path: listPath, DomainsPath: domainsPath}},
	}
}

// construct builds a core instance from a generated config, without the TUN
// inbound (creating one needs root). It proves more than parsing: every tag a
// rule points at — outbound, DNS server, rule-set — has to exist.
func construct(t *testing.T, configJSON []byte) *box.Box {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal(configJSON, &raw); err != nil {
		t.Fatal(err)
	}
	delete(raw, "inbounds")
	delete(raw, "experimental")
	trimmed, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	ctx := include.Context(context.Background())
	options, err := sbjson.UnmarshalExtendedContext[option.Options](ctx, trimmed)
	if err != nil {
		t.Fatalf("sing-box rejected the config: %v\n%s", err, configJSON)
	}
	ctx, cancel := context.WithCancel(ctx)
	t.Cleanup(cancel)
	instance, err := box.New(box.Options{Context: ctx, Options: options})
	if err != nil {
		t.Fatalf("sing-box could not construct the config: %v\n%s", err, configJSON)
	}
	t.Cleanup(func() { _ = instance.Close() })
	return instance
}

func TestEveryRuleFeatureIsAcceptedByTheCore(t *testing.T) {
	result, err := Build(featureRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 0 {
		t.Errorf("unexpected warnings: %v", result.Warnings)
	}
	instance := construct(t, result.JSON)

	// Owners line up with the rules the core actually built, one to one:
	// live counts are attributed by position.
	routeRules, _ := routeSection(t, result.JSON)
	if len(result.RuleOwners) != len(routeRules) {
		t.Fatalf("%d owners for %d rules", len(result.RuleOwners), len(routeRules))
	}
	if built := len(instance.Router().Rules()); built != len(routeRules) {
		t.Fatalf("the core built %d rules from %d", built, len(routeRules))
	}
	owned := map[string]bool{}
	for _, owner := range result.RuleOwners {
		owned[owner] = true
	}
	for _, id := range []string{"combo", "except", "udp", "not-browsers", "stream", "local", "lists", "torrent"} {
		if !owned[id] {
			t.Errorf("rule %q produced nothing", id)
		}
	}
}

func TestRuleFeaturesReachTheConfig(t *testing.T) {
	result, err := Build(featureRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Outbounds []map[string]any `json:"outbounds"`
		DNS       struct {
			Servers []map[string]any `json:"servers"`
			Rules   []map[string]any `json:"rules"`
		} `json:"dns"`
		Route struct {
			Rules   []map[string]any `json:"rules"`
			RuleSet []map[string]any `json:"rule_set"`
		} `json:"route"`
	}
	if err := json.Unmarshal(result.JSON, &config); err != nil {
		t.Fatal(err)
	}
	byOwner := map[string]map[string]any{}
	for index, owner := range result.RuleOwners {
		if owner != "" {
			byOwner[owner] = config.Route.Rules[index]
		}
	}

	// The server rule goes through its own outbound, not the connected one.
	stream := byOwner["stream"]
	var jpTag string
	for _, outbound := range config.Outbounds {
		if outbound["server"] == "jp.example.com" {
			jpTag, _ = outbound["tag"].(string)
		}
	}
	if jpTag == "" || jpTag == ExitTag || stream["outbound"] != jpTag {
		t.Errorf("per-rule server: outbound %v, Japan outbound %q", stream["outbound"], jpTag)
	}

	if drop := byOwner["udp"]; drop["action"] != "reject" || drop["method"] != "drop" {
		t.Errorf("drop: %v", drop)
	}
	if inverted := byOwner["not-browsers"]; inverted["invert"] != true || inverted["action"] != "reject" {
		t.Errorf("inverted block: %v", inverted)
	}
	if combo := byOwner["combo"]; combo["type"] != "logical" || combo["mode"] != "and" {
		t.Errorf("combined rule: %v", combo)
	}

	// A protocol a rule matches has to be sniffed for, or it never matches.
	sniff := config.Route.Rules[1]
	if !strings.Contains(strings.Join(anyStrings(sniff["sniffer"]), ","), "bittorrent") {
		t.Errorf("bittorrent is not sniffed: %v", sniff)
	}

	// The compiled list is left to the core; the plain one was converted.
	var remote, local bool
	for _, set := range config.Route.RuleSet {
		if set["url"] == "https://lists.example/ads.srs" {
			remote = true
		}
		if set["tag"] == ListTag("https://lists.example/blocked.lst") && set["type"] == "local" {
			local = true
		}
	}
	if !remote || !local {
		t.Errorf("rule lists: remote %v, local %v: %v", remote, local, config.Route.RuleSet)
	}

	// Per-rule resolvers exist, and the streaming one asks through Japan.
	var doh map[string]any
	for _, server := range config.DNS.Servers {
		if server["server"] == "dns.google" {
			doh = server
		}
	}
	if doh == nil || doh["type"] != "https" || doh["detour"] != jpTag || doh["domain_resolver"] != dnsDirectTag {
		t.Errorf("per-rule DoH server: %v", doh)
	}
}

func TestMissingServerFallsBackWithAWarning(t *testing.T) {
	request := featureRequest(t)
	request.Profiles = request.Profiles[:1]
	result, err := Build(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) == 0 {
		t.Error("a rule pointing at a deleted server should be reported")
	}
	construct(t, result.JSON)
}

func TestUnavailableListDropsAnAllOfRule(t *testing.T) {
	settings := models.DefaultSettings()
	settings.RoutingRules = []models.RoutingRule{{
		ID: "r", Kind: models.SourceLogical, Mode: models.LogicalAnd, Action: models.ActionBlock,
		Conditions: []models.RoutingCondition{
			{Kind: models.SourceRuleSet, Values: []string{"https://lists.example/missing.txt"}},
			{Kind: models.SourcePort, Values: []string{"443"}},
		},
	}}
	settings.Normalize()
	rules, _ := buildRouteRules(settings, nil, geoSources{})
	for _, rule := range rules {
		if rule["action"] == "reject" && rule["ip_version"] == nil {
			t.Fatalf("with the list missing, blocking all of port 443 is not what was asked: %v", rule)
		}
	}
}

func anyStrings(value any) []string {
	list, _ := value.([]any)
	result := make([]string, 0, len(list))
	for _, item := range list {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func TestLoggingOffDisablesTheCoreLog(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		result := buildFor(t, mainLink, func(settings *models.AppSettings) {
			settings.LoggingEnabled = &enabled
		})
		options := mustParse(t, result.JSON)
		if options.Log == nil || options.Log.Disabled == enabled {
			t.Errorf("logging %v: core log %+v", enabled, options.Log)
		}
	}
}
