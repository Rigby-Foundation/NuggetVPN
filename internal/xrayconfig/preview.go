package xrayconfig

import (
	"fmt"
	"strings"

	"github.com/Rigby-Foundation/Kage/internal/models"
	"github.com/xtls/xray-core/common/geodata/strmatcher"
)

type DomainMatchPreview struct {
	Matched bool   `json:"matched"`
	Pattern string `json:"pattern,omitempty"`
}

// PreviewDomainMatch uses Xray's own matcher and the same domain selectors as
// the generated Lua router. Testing a name does not resolve it or send traffic.
func PreviewDomainMatch(kind string, values []string, domain string) (DomainMatchPreview, error) {
	var result DomainMatchPreview
	if kind != models.SourceDomains && kind != models.SourceDomainRegex {
		return result, fmt.Errorf("choose a domain rule to test")
	}
	domain, err := strmatcher.ToDomain(strings.TrimSuffix(strings.TrimSpace(domain), "."))
	if err != nil || domain == "" {
		return result, fmt.Errorf("enter a hostname such as video.example.com")
	}
	if len(values) > 10000 {
		return result, fmt.Errorf("test at most 10,000 patterns at once")
	}
	selectors := domainValues(values)
	if kind == models.SourceDomainRegex {
		selectors = make([]string, len(values))
		for i, value := range values {
			selectors[i] = "regexp:" + value
		}
	}
	for index, selector := range selectors {
		prefix, pattern, _ := strings.Cut(selector, ":")
		matcherType, known := map[string]strmatcher.Type{"full": strmatcher.Full, "domain": strmatcher.Domain, "keyword": strmatcher.Substr, "regexp": strmatcher.Regex}[prefix]
		if !known {
			return result, fmt.Errorf("%q is not a supported domain match prefix", prefix)
		}
		matcher, err := matcherType.NewDomainPattern(pattern)
		if err != nil {
			return result, fmt.Errorf("pattern %d: %w", index+1, err)
		}
		if matcher.Match(domain) && !result.Matched {
			result.Matched, result.Pattern = true, values[index]
		}
	}
	return result, nil
}
