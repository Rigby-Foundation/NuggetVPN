package app

import (
	"slices"
	"testing"
)

func TestParseRuleListFormats(t *testing.T) {
	list := parseRuleList([]byte(`# a comment
example.com
*.wild.example
+.clash.example
0.0.0.0 ads.example
127.0.0.1 localhost
1.2.3.0/24
5.6.7.8
payload:
  - 'DOMAIN-SUFFIX,suffix.example'
  - 'IP-CIDR,9.9.9.0/24,no-resolve'
DOMAIN-KEYWORD,tracker
full:exact.example
regexp:^ad[0-9]+\.
пример.рф
https://not-a-host/
garbage line here
`))
	for _, want := range []string{"example.com", "exact.example", "xn--e1afmkfd.xn--p1ai"} {
		if !slices.Contains(list.domain, want) {
			t.Errorf("domain %q missing: %v", want, list.domain)
		}
	}
	for _, want := range []string{".example.com", ".wild.example", ".clash.example", ".ads.example", ".suffix.example"} {
		if !slices.Contains(list.suffix, want) {
			t.Errorf("suffix %q missing: %v", want, list.suffix)
		}
	}
	for _, want := range []string{"1.2.3.0/24", "5.6.7.8/32", "9.9.9.0/24"} {
		if !slices.Contains(list.cidr, want) {
			t.Errorf("cidr %q missing: %v", want, list.cidr)
		}
	}
	if !slices.Contains(list.keyword, "tracker") || len(list.regex) != 1 {
		t.Errorf("keyword/regex: %v %v", list.keyword, list.regex)
	}
	for _, unwanted := range []string{"localhost", "wild.example"} {
		if slices.Contains(list.domain, unwanted) {
			t.Errorf("%q should not be an exact domain", unwanted)
		}
	}
}

func TestErrorPageIsNotAList(t *testing.T) {
	if count := parseRuleList([]byte("<html><body>Not found</body></html>")).count(); count != 0 {
		t.Errorf("an HTML page parsed as %d entries", count)
	}
}
