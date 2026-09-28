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
