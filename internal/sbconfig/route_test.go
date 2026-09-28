package sbconfig

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// routeRules decodes just the route section of a generated config.
type routeRule struct {
	Domain       []string `json:"domain"`
	DomainSuffix []string `json:"domain_suffix"`
	IPCIDR       []string `json:"ip_cidr"`
	ProcessName  []string `json:"process_name"`
	ProcessPath  []string `json:"process_path"`
	Outbound     string   `json:"outbound"`
	Action       string   `json:"action"`
	IPIsPrivate  bool     `json:"ip_is_private"`
	Port         []int    `json:"port"`
}

func routeSection(t *testing.T, configJSON []byte) (rules []routeRule, final string) {
	t.Helper()
	var config struct {
		Route struct {
			Rules []routeRule `json:"rules"`
			Final string      `json:"final"`
		} `json:"route"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	return config.Route.Rules, config.Route.Final
}

// graph builds a config from a routing graph, and parses it through sing-box's
// own option decoder so an invalid rule fails the test rather than the user.
func graph(t *testing.T, defaultAction string, rules ...models.RoutingRule) ([]routeRule, string, []byte) {
	t.Helper()
	result := buildFor(t, protocolLinks["vless-reality"], func(settings *models.AppSettings) {
		settings.DefaultAction = defaultAction
		settings.RoutingRules = rules
	})
	mustParse(t, result.JSON)
	parsed, final := routeSection(t, result.JSON)
	return parsed, final, result.JSON
}

// findRule returns the first rule the predicate accepts.
func findRule(rules []routeRule, match func(routeRule) bool) (routeRule, bool) {
	for _, rule := range rules {
		if match(rule) {
			return rule, true
		}
	}
	return routeRule{}, false
}

// TestGraphRoutesEachSourceKind covers the three source kinds reaching sing-box
// with the right matcher, which is the whole point of the routing graph.
func TestGraphRoutesEachSourceKind(t *testing.T) {
	rules, final, _ := graph(t, models.ActionDirect,
		models.RoutingRule{
			ID: "a", Kind: models.SourceApps,
			Values: []string{"Safari.app"}, Action: models.ActionProxy,
		},
		models.RoutingRule{
			ID: "d", Kind: models.SourceDomains,
			Values: []string{"example.org"}, Action: models.ActionProxy,
		},
		models.RoutingRule{
			ID: "i", Kind: models.SourceIP,
			Values: []string{"1.1.1.0/24"}, Action: models.ActionBlock,
		},
	)

	if final != DirectTag {
		t.Errorf("final = %q, want %q", final, DirectTag)
	}
	if _, ok := findRule(rules, func(r routeRule) bool {
		return len(r.ProcessName) > 0 && r.Outbound == ExitTag
	}); !ok {
		t.Error("no process_name rule routed to the proxy")
	}
	if _, ok := findRule(rules, func(r routeRule) bool {
		return len(r.Domain) > 0 && r.Outbound == ExitTag
	}); !ok {
		t.Error("no domain rule routed to the proxy")
	}

	blocked, ok := findRule(rules, func(r routeRule) bool { return len(r.IPCIDR) > 0 })
	if !ok {
		t.Fatal("no ip_cidr rule was emitted")
	}
	if blocked.Action != "reject" {
		t.Errorf("block rule action = %q, want reject", blocked.Action)
	}
	if blocked.IPCIDR[0] != "1.1.1.0/24" {
		t.Errorf("ip_cidr = %v", blocked.IPCIDR)
	}
}

// TestDomainMatchingIsNotASuffixTrap pins the fix for a matcher that was wrong
// in a way nobody would notice until it mattered: sing-box domain_suffix is a
// raw string comparison, so a bare "example.com" also matches
// "notexample.com". A plain entry must produce an exact match plus a
// dot-prefixed suffix, never the bare string.
func TestDomainMatchingIsNotASuffixTrap(t *testing.T) {
	rules, _, _ := graph(t, models.ActionDirect, models.RoutingRule{
		ID: "d", Kind: models.SourceDomains,
		Values: []string{"example.com", "*.wildcard.net"}, Action: models.ActionProxy,
	})

	rule, ok := findRule(rules, func(r routeRule) bool { return len(r.Domain)+len(r.DomainSuffix) > 0 })
	if !ok {
		t.Fatal("no domain rule emitted")
	}

	if !contains(rule.Domain, "example.com") {
		t.Errorf("expected an exact match for example.com, got %v", rule.Domain)
	}
	if !contains(rule.DomainSuffix, ".example.com") {
		t.Errorf("expected a .example.com suffix, got %v", rule.DomainSuffix)
	}
	if contains(rule.DomainSuffix, "example.com") {
		t.Error("bare domain_suffix would also match notexample.com")
	}
	if !contains(rule.DomainSuffix, ".wildcard.net") {
		t.Errorf("expected *.wildcard.net to become a .wildcard.net suffix, got %v", rule.DomainSuffix)
	}
	if contains(rule.Domain, "*.wildcard.net") {
		t.Error("the wildcard was passed through literally")
	}
}

// TestDefaultBlockEmitsCatchAll checks the one destination route.final cannot
// express: it names an outbound, and there is no reject outbound.
func TestDefaultBlockEmitsCatchAll(t *testing.T) {
	rules, final, _ := graph(t, models.ActionBlock)

	last := rules[len(rules)-1]
	if last.Action != "reject" {
		t.Fatalf("expected a trailing reject rule, got %+v", last)
	}
	if len(last.Domain)+len(last.IPCIDR)+len(last.ProcessName) != 0 {
		t.Error("the catch-all reject must not carry matchers")
	}
	if final == "" {
		t.Error("route.final must still name an outbound")
	}
}

// TestFullTunnelKeepsFakeIP guards the DNS decision: fake-IP is only safe when
// every connection is resolved at the far end, so any rule that sends traffic
// off the tunnel has to switch it off.
func TestFullTunnelKeepsFakeIP(t *testing.T) {
	_, final, full := graph(t, models.ActionProxy)
	if final != ExitTag {
		t.Errorf("full tunnel final = %q, want %q", final, ExitTag)
	}
	if !strings.Contains(string(full), "fakeip") {
		t.Error("a full tunnel should use fake-IP DNS")
	}

	// One direct rule is enough to make it unsafe.
	_, _, split := graph(t, models.ActionProxy, models.RoutingRule{
		ID: "d", Kind: models.SourceDomains,
		Values: []string{"intranet.example"}, Action: models.ActionDirect,
	})
	if strings.Contains(string(split), "fakeip") {
		t.Error("a rule routing traffic direct must disable fake-IP")
	}
}

// TestProxiedDomainsResolveThroughTunnel checks that a domain sent through the
// tunnel is also resolved through it. Resolving locally would hand the exit an
// address chosen by the user's ISP.
func TestProxiedDomainsResolveThroughTunnel(t *testing.T) {
	_, _, configJSON := graph(t, models.ActionDirect, models.RoutingRule{
		ID: "d", Kind: models.SourceDomains,
		Values: []string{"example.org"}, Action: models.ActionProxy,
	})

	var config struct {
		DNS struct {
			Rules []struct {
				Domain       []string `json:"domain"`
				DomainSuffix []string `json:"domain_suffix"`
				Server       string   `json:"server"`
			} `json:"rules"`
		} `json:"dns"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for _, rule := range config.DNS.Rules {
		if contains(rule.Domain, "example.org") && rule.Server == dnsProxyTag {
			return
		}
	}
	t.Errorf("proxied domain has no DNS rule pointing at the tunnel resolver:\n%s", configJSON)
}

// TestUnusableRulesAreDropped keeps half-finished rows in the editor from
// reaching the config, where an empty or malformed matcher would either fail to
// parse or match everything.
func TestUnusableRulesAreDropped(t *testing.T) {
	rules, _, _ := graph(t, models.ActionDirect,
		models.RoutingRule{ID: "empty", Kind: models.SourceDomains, Values: nil, Action: models.ActionProxy},
		models.RoutingRule{ID: "blank", Kind: models.SourceApps, Values: []string{"  "}, Action: models.ActionProxy},
		models.RoutingRule{ID: "badip", Kind: models.SourceIP, Values: []string{"not-an-ip"}, Action: models.ActionBlock},
		models.RoutingRule{ID: "badkind", Kind: "nonsense", Values: []string{"x"}, Action: models.ActionProxy},
	)

	for _, rule := range rules {
		if rule.IPIsPrivate || rule.Action == "sniff" || rule.Action == "hijack-dns" || len(rule.Port) > 0 {
			continue
		}
		if len(rule.Domain)+len(rule.DomainSuffix)+len(rule.IPCIDR)+
			len(rule.ProcessName)+len(rule.ProcessPath) == 0 {
			t.Errorf("an unusable rule produced a matcher-less rule: %+v", rule)
		}
	}
}

// TestPrivateRangesStayLocal guards LAN access: whatever the graph says, the
// printer and the router have to stay reachable.
func TestPrivateRangesStayLocal(t *testing.T) {
	rules, _, _ := graph(t, models.ActionProxy)

	rule, ok := findRule(rules, func(r routeRule) bool { return r.IPIsPrivate })
	if !ok {
		t.Fatal("no ip_is_private rule emitted")
	}
	if rule.Outbound != DirectTag {
		t.Errorf("private ranges go to %q, want %q", rule.Outbound, DirectTag)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
