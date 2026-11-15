package models

import "testing"

func TestRuleEditorRejectsInvalidEntries(t *testing.T) {
	for _, rule := range []RoutingRule{
		{Kind: SourcePort, Values: []string{"443", "not-a-port"}, Action: ActionProxy},
		{Kind: SourceIP, Values: []string{"999.1.1.1"}, Action: ActionDirect},
		{Kind: SourceDomainRegex, Values: []string{"(?=ads)"}, Action: ActionBlock},
		{Kind: SourceLogical, Action: ActionProxy},
		{Kind: SourceProtocol, Values: []string{"dns"}, Action: ActionBlock},
		{Kind: SourceRuleSet, Values: []string{"https://example.com/list.srs"}, Action: ActionBlock},
		{Kind: SourceDomains, Values: []string{"example.com"}, Invert: true, DNS: "1.1.1.1", Action: ActionProxy},
		{Kind: SourceGeoSite, Values: []string{"google"}, DNS: "1.1.1.1", Action: ActionProxy},
		{Kind: SourceDomains, Values: []string{"example.com"}, DNS: "tls://one.one.one.one", Action: ActionProxy},
	} {
		if ValidateRoutingRule(rule) == nil {
			t.Errorf("invalid rule accepted: %+v", rule)
		}
	}
	if err := ValidateRoutingRule(RoutingRule{Kind: SourceLogical, Mode: LogicalAnd, Action: ActionProxy, Conditions: []RoutingCondition{{Kind: SourceDomains, Values: []string{"example.com"}}, {Kind: SourcePort, Values: []string{"443", "8000-8080"}}}}); err != nil {
		t.Fatal(err)
	}
}
