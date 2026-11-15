package xrayconfig

import "testing"

func TestDomainPreviewMatchesXraySelectors(t *testing.T) {
	for _, test := range []struct {
		kind, pattern, domain string
		matches               bool
	}{
		{"domains", "example.com", "video.example.com", true},
		{"domains", "example.com", "notexample.com", false},
		{"domains", "*.example.com", "example.com", false},
		{"domains", "*.example.com", "video.example.com", true},
		{"domains", "full:example.com", "video.example.com", false},
		{"domains", "full:example.com", "EXAMPLE.COM", true},
		{"domain_regex", `(^|\.)ads?\.example\.com$`, "ads.example.com", true},
		{"domain_regex", `(^|\.)ads?\.example\.com$`, "ads.example.com.evil.test", false},
	} {
		result, err := PreviewDomainMatch(test.kind, []string{test.pattern}, test.domain)
		if err != nil || result.Matched != test.matches {
			t.Errorf("%s %q / %q: %+v, %v", test.kind, test.pattern, test.domain, result, err)
		}
	}
	if _, err := PreviewDomainMatch("domain_regex", []string{`(?=ads)`}, "ads.example.com"); err == nil {
		t.Fatal("lookahead accepted despite Xray's RE2 syntax")
	}
}
