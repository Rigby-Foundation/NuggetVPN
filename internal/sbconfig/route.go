package sbconfig

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/Rigby-Foundation/NuggetVPN/internal/models"
)

// privateRanges are the networks that must never enter the tunnel. They are
// listed explicitly, rather than relying on a matcher, because the TUN excludes
// them at the interface where only a prefix list will do.
var privateRanges = []string{
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"169.254.0.0/16",
	"224.0.0.0/4",
	"255.255.255.255/32",
}

// localSuffixes only mean something on the local network.
var localSuffixes = []string{"local", "lan", "home.arpa"}

// connectivityCheckDomains are what Windows fetches to decide whether it has
// internet at all.
var connectivityCheckDomains = []string{"msftconnecttest.com", "msftncsi.com"}

// buildRouteRules turns the routing graph into sing-box route rules, and
// reports how many of the user's entries were emitted.
//
// Order matters: sing-box takes the first matching rule, so the graph is
// emitted top to bottom and whatever matches nothing falls through to
// route.final.
func buildRouteRules(settings models.AppSettings, serverDomains []string) ([]map[string]any, int) {
	rules := []map[string]any{
		// Anything still reaching port 53 is DNS. The TUN captures it through
		// dns_mode as well; this covers the local mixed proxy.
		{"port": []int{53}, "action": "hijack-dns"},
		// Name the sniffers rather than running all of them, and bound how
		// long a connection waits to be identified. An unbounded sniff on
		// every connection adds latency to protocols that will never match.
		{
			"action":  "sniff",
			"sniffer": []string{"tls", "http", "quic"},
			"timeout": "500ms",
		},
	}

	// Private ranges stay on the local network whatever the graph says;
	// tunnelling them breaks LAN access and, with it, the user's printer.
	rules = append(rules, map[string]any{"ip_is_private": true, "outbound": DirectTag})

	// The proxy's own hostname must never be routed into the tunnel it is
	// dialing, or the connection chases its own tail.
	if len(serverDomains) > 0 {
		rules = append(rules, map[string]any{
			"domain":   serverDomains,
			"outbound": DirectTag,
		})
	}

	// Names that only mean something on the local network.
	rules = append(rules, map[string]any{
		"domain_suffix": localSuffixes,
		"outbound":      DirectTag,
	})

	// Windows decides whether it has internet by fetching these. Through a
	// tunnel the check is unreliable, and when it fails Windows reports no
	// connectivity and some applications refuse to work at all.
	rules = append(rules, map[string]any{
		"domain_suffix": connectivityCheckDomains,
		"outbound":      DirectTag,
	})

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

		case models.SourceDomainRegex:
			rules = append(rules, withAction(map[string]any{
				"domain_regex": values,
			}, rule.Action))

		case models.SourcePort:
			single, ranges := splitPorts(values)
			matcher := map[string]any{}
			if len(single) > 0 {
				matcher["port"] = single
			}
			if len(ranges) > 0 {
				matcher["port_range"] = ranges
			}
			if len(matcher) > 0 {
				rules = append(rules, withAction(matcher, rule.Action))
			}

		case models.SourceProtocol:
			rules = append(rules, withAction(map[string]any{
				"protocol": values,
			}, rule.Action))

		case models.SourceGeoSite, models.SourceGeoIP:
			// Geo matching is a rule-set reference; the sets themselves are
			// declared in route.rule_set by ruleSets below.
			tags := make([]string, 0, len(values))
			for _, value := range values {
				tags = append(tags, ruleSetTag(rule.Kind, value))
			}
			rules = append(rules, withAction(map[string]any{
				"rule_set": tags,
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

	// The resolver is pinned to IPv4, so a name never yields a v6 address. An
	// application dialing a v6 literal anyway would otherwise sit waiting for a
	// route that does not exist; refusing it fails fast and lets the app fall
	// back to IPv4.
	rules = append(rules, map[string]any{"ip_version": 6, "action": "reject"})

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

// Rule-set sources.
//
// geoip and geosite as rule fields were removed in sing-box 1.12; the core
// answers a config using them with "removed in sing-box 1.12.0". Geo matching
// is now a rule-set reference, and the sets are fetched as compiled binaries.
const (
	geoSiteURL = "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-%s.srs"
	geoIPURL   = "https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-%s.srs"
	// ruleSetUpdateInterval is how often a set is refreshed. Country and
	// category lists move slowly, and each check is a request to GitHub.
	ruleSetUpdateInterval = "168h"
)

// ruleSetTag names the set a geo value refers to.
func ruleSetTag(kind, value string) string {
	return kind + "-" + value
}

// ruleSets declares every rule-set the graph refers to.
//
// They download through the tunnel rather than directly: someone who needs
// geo-based routing is often somewhere that GitHub is unreachable from, and
// the proxy does not depend on the sets to come up.
func ruleSets(settings models.AppSettings) []map[string]any {
	seen := map[string]bool{}
	var sets []map[string]any

	for _, rule := range settings.UsableRules() {
		var template string
		switch rule.Kind {
		case models.SourceGeoSite:
			template = geoSiteURL
		case models.SourceGeoIP:
			template = geoIPURL
		default:
			continue
		}

		for _, value := range rule.CleanValues() {
			tag := ruleSetTag(rule.Kind, value)
			if seen[tag] {
				continue
			}
			seen[tag] = true
			sets = append(sets, map[string]any{
				"type":            "remote",
				"tag":             tag,
				"format":          "binary",
				"url":             fmt.Sprintf(template, value),
				"download_detour": ExitTag,
				"update_interval": ruleSetUpdateInterval,
			})
		}
	}
	return sets
}

// splitPorts separates single ports from inclusive ranges, which the core
// takes in two different fields.
func splitPorts(values []string) (single []uint16, ranges []string) {
	for _, value := range values {
		low, high, isRange := strings.Cut(value, "-")
		if isRange {
			// The core spells a range with a colon.
			ranges = append(ranges, strings.TrimSpace(low)+":"+strings.TrimSpace(high))
			continue
		}
		port, err := strconv.Atoi(strings.TrimSpace(low))
		if err != nil {
			continue
		}
		single = append(single, uint16(port))
	}
	return single, ranges
}

// buildRouteSection assembles the route block, including any rule-sets the graph
// refers to. The sets are only declared when something actually uses one, so a
// configuration without geo rules makes no network requests for them.
func buildRouteSection(settings models.AppSettings, rules []map[string]any) map[string]any {
	route := map[string]any{
		"rules":                   rules,
		"final":                   finalOutbound(settings),
		"auto_detect_interface":   true,
		"default_domain_resolver": map[string]any{"server": dnsDirectTag},
	}
	if sets := ruleSets(settings); len(sets) > 0 {
		route["rule_set"] = sets
	}
	return route
}
