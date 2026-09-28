package sbconfig

import (
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// buildRouteRules turns the routing graph into sing-box route rules, and
// reports how many of the user's entries were emitted.
//
// Order matters: sing-box takes the first matching rule, so the graph is
// emitted top to bottom and whatever matches nothing falls through to
// route.final.
func buildRouteRules(settings models.AppSettings) ([]map[string]any, int) {
	rules := []map[string]any{
		// Sniffing gives the router real domains for fake-IP traffic.
		{"action": "sniff"},
		{"protocol": "dns", "action": "hijack-dns"},
	}

	// Private ranges stay on the local network whatever the graph says;
	// tunnelling them breaks LAN access and, with it, the user's printer.
	rules = append(rules, map[string]any{"ip_is_private": true, "outbound": DirectTag})

	matched := 0
	for _, rule := range settings.UsableRules() {
		values := rule.CleanValues()

		switch rule.Kind {
		case models.SourceApps:
			processPaths := extractProcessPaths(values)
			processNames := mergeProcessNames(expandProcessNames(values), processPaths)

			if len(processNames) > 0 {
				rules = append(rules, withAction(map[string]any{
					"process_name": processNames,
				}, rule.Action))
			}
			if len(processPaths) > 0 {
				rules = append(rules, withAction(map[string]any{
					"process_path": processPaths,
				}, rule.Action))
			}

		case models.SourceDomains:
			exact, suffixes := splitDomains(values)
			matcher := map[string]any{}
			if len(exact) > 0 {
				matcher["domain"] = exact
			}
			if len(suffixes) > 0 {
				matcher["domain_suffix"] = suffixes
			}
			if len(matcher) > 0 {
				rules = append(rules, withAction(matcher, rule.Action))
			}

		case models.SourceIP:
			rules = append(rules, withAction(map[string]any{
				"ip_cidr": values,
			}, rule.Action))
		}
		matched += len(values)
	}

	// Winbox management traffic has always been forced through the tunnel.
	if settings.SplitTunnelling() {
		rules = append(rules, map[string]any{
			"port":     []int{winboxPort},
			"outbound": ExitTag,
		})
	}

	// route.final cannot reject, so a default of "block" becomes a catch-all
	// rule at the very bottom instead.
	if settings.DefaultAction == models.ActionBlock {
		rules = append(rules, map[string]any{"action": "reject"})
	}

	return rules, matched
}

// withAction attaches the destination to a matcher.
func withAction(matcher map[string]any, action string) map[string]any {
	switch action {
	case models.ActionBlock:
		matcher["action"] = "reject"
	case models.ActionDirect:
		matcher["outbound"] = DirectTag
	default:
		matcher["outbound"] = ExitTag
	}
	return matcher
}

// splitDomains separates exact hostnames from suffix patterns.
//
// "*.example.com" is a suffix match on ".example.com". A bare "example.com"
// means the site and everything under it, so it becomes both an exact match and
// a ".example.com" suffix — not a bare domain_suffix, which is a raw string
// comparison and would also match "notexample.com".
func splitDomains(values []string) (exact, suffixes []string) {
	seenExact := map[string]bool{}
	seenSuffix := map[string]bool{}

	add := func(list *[]string, seen map[string]bool, value string) {
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		*list = append(*list, value)
	}

	for _, value := range values {
		domain := strings.ToLower(strings.TrimSpace(value))
		domain = strings.TrimSuffix(domain, ".")
		if domain == "" {
			continue
		}

		if after, ok := strings.CutPrefix(domain, "*."); ok {
			if after != "" {
				add(&suffixes, seenSuffix, "."+after)
			}
			continue
		}
		if strings.HasPrefix(domain, ".") {
			add(&suffixes, seenSuffix, domain)
			continue
		}

		add(&exact, seenExact, domain)
		add(&suffixes, seenSuffix, "."+domain)
	}
	return exact, suffixes
}

// finalOutbound is where traffic goes when no rule matched. A "block" default
// is handled by the catch-all reject rule, so this only has to pick a side.
func finalOutbound(settings models.AppSettings) string {
	if settings.DefaultAction == models.ActionProxy {
		return ExitTag
	}
	return DirectTag
}

// proxiedDomains collects the domains the graph routes through the tunnel, so
// the DNS section can resolve them at the exit rather than locally.
func proxiedDomains(settings models.AppSettings) (exact, suffixes []string) {
	for _, rule := range settings.UsableRules() {
		if rule.Kind != models.SourceDomains || rule.Action != models.ActionProxy {
			continue
		}
		ruleExact, ruleSuffixes := splitDomains(rule.CleanValues())
		exact = append(exact, ruleExact...)
		suffixes = append(suffixes, ruleSuffixes...)
	}
	return dedupe(exact), dedupe(suffixes)
}
