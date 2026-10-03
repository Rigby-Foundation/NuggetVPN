package models

import "testing"

// legacySettings is a settings.json written before the routing graph existed:
// neither routing_rules nor default_action is present.
func legacySettings(mode string, apps, domains []string) AppSettings {
	return AppSettings{
		RoutingMode:    mode,
		RoutingApps:    apps,
		RoutingDomains: domains,
	}
}

// TestMigrationPreservesLegacyRouting is the test that matters on upgrade: the
// tunnel must route exactly what it routed before, without the user touching
// anything. Getting this wrong either tunnels traffic that used to go direct
// (a privacy change they did not ask for) or stops tunnelling traffic they
// rely on being tunnelled.
func TestMigrationPreservesLegacyRouting(t *testing.T) {
	cases := []struct {
		name          string
		settings      AppSettings
		wantDefault   string
		wantRuleKinds []string
	}{
		{
			name:          "full tunnel stays a full tunnel",
			settings:      legacySettings(RoutingAll, nil, nil),
			wantDefault:   ActionProxy,
			wantRuleKinds: nil,
		},
		{
			name:          "an unset mode is a full tunnel",
			settings:      legacySettings("", nil, nil),
			wantDefault:   ActionProxy,
			wantRuleKinds: nil,
		},
		{
			name:          "apps only",
			settings:      legacySettings(RoutingApps, []string{"Safari.app"}, []string{"ignored.example"}),
			wantDefault:   ActionDirect,
			wantRuleKinds: []string{SourceApps},
		},
		{
			name:          "domains only",
			settings:      legacySettings(RoutingDomains, []string{"ignored.app"}, []string{"example.org"}),
			wantDefault:   ActionDirect,
			wantRuleKinds: []string{SourceDomains},
		},
		{
			name:          "apps and domains",
			settings:      legacySettings(RoutingAppsDomains, []string{"Safari.app"}, []string{"example.org"}),
			wantDefault:   ActionDirect,
			wantRuleKinds: []string{SourceApps, SourceDomains},
		},
		{
			name:          "the legacy selected alias",
			settings:      legacySettings(RoutingSelected, []string{"Safari.app"}, []string{"example.org"}),
			wantDefault:   ActionDirect,
			wantRuleKinds: []string{SourceApps, SourceDomains},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			settings := testCase.settings
			settings.Normalize()

			if settings.DefaultAction != testCase.wantDefault {
				t.Errorf("default = %q, want %q", settings.DefaultAction, testCase.wantDefault)
			}
			if len(settings.RoutingRules) != len(testCase.wantRuleKinds) {
				t.Fatalf("got %d rules, want %d: %+v",
					len(settings.RoutingRules), len(testCase.wantRuleKinds), settings.RoutingRules)
			}
			for i, kind := range testCase.wantRuleKinds {
				rule := settings.RoutingRules[i]
				if rule.Kind != kind {
					t.Errorf("rule %d kind = %q, want %q", i, rule.Kind, kind)
				}
				// Everything the old modes listed was sent through the tunnel.
				if rule.Action != ActionProxy {
					t.Errorf("rule %d action = %q, want %q", i, rule.Action, ActionProxy)
				}
				if len(rule.Values) == 0 {
					t.Errorf("rule %d migrated with no values", i)
				}
			}
		})
	}
}

// TestMigrationRunsOnce checks the migration cannot resurrect deleted rules.
// Someone who clears the graph has an empty rule list and a chosen default;
// rebuilding from the legacy fields on the next load would silently restore
// routing they deliberately removed.
func TestMigrationRunsOnce(t *testing.T) {
	settings := legacySettings(RoutingAppsDomains, []string{"Safari.app"}, []string{"example.org"})
	settings.Normalize()
	if len(settings.RoutingRules) == 0 {
		t.Fatal("expected the first normalize to migrate")
	}

	// The user deletes every rule and saves.
	settings.RoutingRules = []RoutingRule{}
	settings.DefaultAction = ActionDirect
	settings.Normalize()

	if len(settings.RoutingRules) != 0 {
		t.Errorf("migration repopulated deleted rules: %+v", settings.RoutingRules)
	}
	if settings.DefaultAction != ActionDirect {
		t.Errorf("migration overwrote the chosen default with %q", settings.DefaultAction)
	}
}

// TestNormalizeDropsUnusableRules keeps malformed rows out of the config.
func TestNormalizeDropsUnusableRules(t *testing.T) {
	settings := DefaultSettings()
	settings.RoutingRules = []RoutingRule{
		{ID: "ok", Kind: SourceDomains, Values: []string{"example.org"}, Action: ActionProxy},
		{ID: "bad-kind", Kind: "telepathy", Values: []string{"x"}, Action: ActionProxy},
		{ID: "bad-action", Kind: SourceDomains, Values: []string{"x"}, Action: "teleport"},
	}
	settings.Normalize()

	if len(settings.RoutingRules) != 1 || settings.RoutingRules[0].ID != "ok" {
		t.Fatalf("expected only the valid rule to survive, got %+v", settings.RoutingRules)
	}
}

func TestDisconnectedRulePreserved(t *testing.T) {
	settings := DefaultSettings()
	settings.RoutingRules = []RoutingRule{
		{ID: "cut", Kind: SourceDomains, Values: []string{"cut.example"}, Action: ""},
	}
	settings.Normalize()

	if len(settings.RoutingRules) != 1 || settings.RoutingRules[0].ID != "cut" {
		t.Fatalf("expected disconnected rule to survive, got %+v", settings.RoutingRules)
	}
	if settings.RoutingRules[0].Usable() {
		t.Fatal("disconnected rule should not be usable")
	}
	if len(settings.UsableRules()) != 0 {
		t.Fatal("usable rules should exclude disconnected rules")
	}
}

// TestCleanValuesRejectsBadAddresses stops a typo in an IP rule from reaching
// sing-box, where it would fail the whole config rather than that one row.
func TestCleanValuesRejectsBadAddresses(t *testing.T) {
	rule := RoutingRule{
		Kind: SourceIP,
		Values: []string{
			"1.1.1.0/24", "8.8.8.8", "2001:db8::/32", "::1",
			"not-an-ip", "999.1.1.1", "1.1.1.0/99", "  ", "1.1.1.0/24",
		},
		Action: ActionBlock,
	}

	got := rule.CleanValues()
	want := []string{"1.1.1.0/24", "8.8.8.8", "2001:db8::/32", "::1"}
	if len(got) != len(want) {
		t.Fatalf("CleanValues() = %v, want %v", got, want)
	}
	for i, value := range want {
		if got[i] != value {
			t.Errorf("CleanValues()[%d] = %q, want %q", i, got[i], value)
		}
	}
}

// TestSplitTunnellingDetectsAnyLeak covers the flag that gates fake-IP DNS.
// Fake-IP is only safe when every connection is resolved at the far end of the
// tunnel, so a single rule pointing anywhere else has to switch it off.
func TestSplitTunnellingDetectsAnyLeak(t *testing.T) {
	cases := []struct {
		name          string
		defaultAction string
		rules         []RoutingRule
		want          bool
	}{
		{"everything through the tunnel", ActionProxy, nil, false},
		{"proxy rules on a proxy default", ActionProxy, []RoutingRule{
			{Kind: SourceDomains, Values: []string{"a.example"}, Action: ActionProxy},
		}, false},
		{"one direct rule", ActionProxy, []RoutingRule{
			{Kind: SourceDomains, Values: []string{"a.example"}, Action: ActionDirect},
		}, true},
		{"one blocked rule", ActionProxy, []RoutingRule{
			{Kind: SourceIP, Values: []string{"1.1.1.0/24"}, Action: ActionBlock},
		}, true},
		{"direct default", ActionDirect, nil, true},
		{"block default", ActionBlock, nil, true},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			settings := DefaultSettings()
			settings.DefaultAction = testCase.defaultAction
			settings.RoutingRules = testCase.rules
			settings.Normalize()

			if got := settings.SplitTunnelling(); got != testCase.want {
				t.Errorf("SplitTunnelling() = %v, want %v", got, testCase.want)
			}
		})
	}
}

// TestNewSourceKindValidation covers the entries the core would refuse. A bad
// value has to be dropped here: the core fails the whole configuration over one
// malformed matcher, so a typo in a port would take every other rule with it.
func TestNewSourceKindValidation(t *testing.T) {
	cases := []struct {
		kind     string
		accepted []string
		rejected []string
	}{
		{
			kind:     SourcePort,
			accepted: []string{"1", "443", "65535", "8000-8080", "80-80"},
			rejected: []string{"0", "65536", "-1", "443-80", "http", "", "80-", "-80", "80-abc"},
		},
		{
			kind: SourceProtocol,
			// "TLS" is absent on purpose: it normalises to "tls" and is then a
			// duplicate, which TestProtocolValuesAreCaseInsensitive covers.
			accepted: []string{"tls", "quic", "bittorrent"},
			rejected: []string{"vless", "tcp", "smtp", ""},
		},
		{
			kind:     SourceGeoIP,
			accepted: []string{"ru", "us", "cn-mainland"},
			rejected: []string{"../etc/passwd", "a b", "US!", "ru/../x", ""},
		},
		{
			kind:     SourceDomainRegex,
			accepted: []string{`^ads?\.`, `.*\.example\.com$`},
			rejected: []string{"([unclosed", "a**", ""},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.kind, func(t *testing.T) {
			rule := RoutingRule{
				Kind:   testCase.kind,
				Values: append(append([]string{}, testCase.accepted...), testCase.rejected...),
				Action: ActionProxy,
			}
			got := rule.CleanValues()

			if len(got) != len(testCase.accepted) {
				t.Fatalf("CleanValues() kept %v, want only %v", got, testCase.accepted)
			}
			for _, value := range got {
				for _, bad := range testCase.rejected {
					if value == bad {
						t.Errorf("kept %q, which the core would refuse", value)
					}
				}
			}
		})
	}
}

// TestGeoValuesAreCaseInsensitive checks a country entered as "US" is the same
// rule as "us" rather than a second one, since the value becomes part of a
// rule-set URL.
func TestGeoValuesAreCaseInsensitive(t *testing.T) {
	rule := RoutingRule{
		Kind:   SourceGeoIP,
		Values: []string{"US", "us", "Us"},
		Action: ActionDirect,
	}
	if got := rule.CleanValues(); len(got) != 1 || got[0] != "us" {
		t.Errorf("CleanValues() = %v, want [us]", got)
	}
}

// TestProtocolValuesAreCaseInsensitive matches the geo behaviour: a protocol
// typed in any case is one rule, not several.
func TestProtocolValuesAreCaseInsensitive(t *testing.T) {
	rule := RoutingRule{
		Kind:   SourceProtocol,
		Values: []string{"TLS", "tls", "Quic"},
		Action: ActionProxy,
	}
	got := rule.CleanValues()
	if len(got) != 2 || got[0] != "tls" || got[1] != "quic" {
		t.Errorf("CleanValues() = %v, want [tls quic]", got)
	}
}
