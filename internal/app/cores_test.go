package app

import "testing"

func TestRuleForText(t *testing.T) {
	texts := map[string]string{
		"netflix.com": "stream",
		"((or,((domainsuffix,a.example) || (domainsuffix,b.example))) && (network,tcp))": "combo",
	}
	for reported, want := range map[string]string{
		"DomainSuffix,netflix.com": "stream",
		"AND,((OR,((DomainSuffix,a.example) || (DomainSuffix,b.example))) && (Network,tcp))": "combo",
		"Match,": DefaultRuleHits,
		"final":  DefaultRuleHits,
	} {
		if got, ok := ruleForText(texts, reported); !ok || got != want {
			t.Errorf("%q → %q, %v; want %q", reported, got, ok, want)
		}
	}
	if _, ok := ruleForText(texts, "DomainSuffix,unknown.example"); ok {
		t.Error("an unknown rule should not be traced to one")
	}
}
