package sbconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"path"
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

// baseSniffers are always run: they recover the domain name, which domain
// rules and the logs depend on.
var baseSniffers = []string{"tls", "http", "quic"}

// DefaultOwner owns the catch-all rule a "block" or "drop" default becomes,
// so connections it takes are counted as unmatched traffic.
const DefaultOwner = "__default"

// routePlan is the route section being assembled, plus what the rest of the
// config needs to know about it.
type routePlan struct {
	settings models.AppSettings
	geo      geoSources
	lists    map[string]RuleList
	// outboundFor maps a server profile id to the outbound that reaches it.
	outboundFor map[string]string

	sets     []map[string]any
	declared map[string]bool

	// Warnings are things the user asked for that could not be done, such as
	// a rule list that has not been downloaded.
	warnings []string

	// bypass sends the bypass entry point straight out; see Request.Bypass.
	bypass bool
}

func newRoutePlan(settings models.AppSettings, geo geoSources, lists map[string]RuleList, outboundFor map[string]string) *routePlan {
	return &routePlan{
		settings:    settings,
		geo:         geo,
		lists:       lists,
		outboundFor: outboundFor,
		declared:    map[string]bool{},
	}
}

// declare adds a rule-set to route.rule_set once.
func (p *routePlan) declare(set map[string]any) string {
	tag := set["tag"].(string)
	if !p.declared[tag] {
		p.declared[tag] = true
		p.sets = append(p.sets, set)
	}
	return tag
}

// buildRouteRules turns the routing graph into sing-box route rules, and
// reports how many of the user's entries were emitted.
//
// Order matters: sing-box takes the first matching rule, so the graph is
// emitted top to bottom and whatever matches nothing falls through to
// route.final.
//
// owners runs alongside the rules: owners[i] is the id of the user's rule
// that produced rules[i], or "" for one the app adds itself. It is how a
// connection the core reports as matched by rule i is counted against a
// node on the canvas.
func (p *routePlan) buildRouteRules(serverDomains []string) (rules []map[string]any, owners []string, matched int) {
	add := func(owner string, rule map[string]any) {
		rules = append(rules, rule)
		owners = append(owners, owner)
	}

	// The engine dialing the servers (Xray) reaches them directly, or its
	// connections would be routed back into itself. First, so nothing below
	// — not even sniffing — touches them.
	if p.bypass {
		add("", map[string]any{"inbound": []string{BypassTag}, "outbound": DirectTag})
	}

	// Anything still reaching port 53 is DNS. The TUN captures it through
	// dns_mode as well; this covers the local mixed proxy.
	add("", map[string]any{"port": []int{53}, "action": "hijack-dns"})
	// Name the sniffers rather than running all of them, and bound how long a
	// connection waits to be identified. An unbounded sniff on every
	// connection adds latency to protocols that will never match.
	add("", map[string]any{
		"action":  "sniff",
		"sniffer": p.sniffers(),
		"timeout": "500ms",
	})

	// Private ranges stay on the local network whatever the graph says;
	// tunnelling them breaks LAN access and, with it, the user's printer.
	add("", map[string]any{"ip_is_private": true, "outbound": DirectTag})

	// The proxy's own hostname must never be routed into the tunnel it is
	// dialing, or the connection chases its own tail.
	if len(serverDomains) > 0 {
		add("", map[string]any{"domain": serverDomains, "outbound": DirectTag})
	}

	// Names that only mean something on the local network.
	add("", map[string]any{"domain_suffix": localSuffixes, "outbound": DirectTag})

	// Windows decides whether it has internet by fetching these. Through a
	// tunnel the check is unreliable, and when it fails Windows reports no
	// connectivity and some applications refuse to work at all.
	add("", map[string]any{"domain_suffix": connectivityCheckDomains, "outbound": DirectTag})

	for _, rule := range p.settings.UsableRules() {
		built, ok := p.rule(rule)
		if !ok {
			continue
		}
		add(rule.ID, p.withAction(built, rule.Action, rule.Server))
		for _, matcher := range rule.Matchers() {
			matched += len(matcher.Values)
		}
	}

	// Winbox management traffic has always been forced through the tunnel.
	if p.settings.SplitTunnelling() {
		add("", map[string]any{"port": []int{winboxPort}, "outbound": ExitTag})
	}

	// The resolver is pinned to IPv4, so a name never yields a v6 address. An
	// application dialing a v6 literal anyway would otherwise sit waiting for a
	// route that does not exist; refusing it fails fast and lets the app fall
	// back to IPv4.
	add("", map[string]any{"ip_version": 6, "action": "reject"})

	// route.final cannot reject, so a default of "block" or "drop" becomes a
	// catch-all rule at the very bottom instead.
	switch p.settings.DefaultAction {
	case models.ActionBlock, models.ActionDrop:
		add(DefaultOwner, p.withAction(map[string]any{}, p.settings.DefaultAction, ""))
	}

	return rules, owners, matched
}

// sniffers is the base set plus every protocol a rule matches on. A protocol
// the core is not asked to sniff for is never detected, so a rule naming it
// would silently match nothing.
func (p *routePlan) sniffers() []string {
	result := append([]string(nil), baseSniffers...)
	seen := map[string]bool{}
	for _, name := range result {
		seen[name] = true
	}
	for _, rule := range p.settings.UsableRules() {
		for _, matcher := range rule.Matchers() {
			if matcher.Kind != models.SourceProtocol {
				continue
			}
			for _, protocol := range matcher.Values {
				if !seen[protocol] {
					seen[protocol] = true
					result = append(result, protocol)
				}
			}
		}
	}
	return result
}

// rule builds the matching part of one of the user's rules. It reports false
// when there is nothing to emit — every entry pointed at a list that could not
// be used — rather than emitting a rule that would match everything.
func (p *routePlan) rule(rule models.RoutingRule) (map[string]any, bool) {
	if rule.Kind != models.SourceLogical {
		built, ok := p.matcher(rule.Matcher())
		return built, ok
	}

	parts := []map[string]any{}
	for _, condition := range rule.UsableConditions() {
		built, ok := p.matcher(condition)
		if !ok {
			// Dropping a condition from "all of" would widen the rule to
			// traffic it was written to exclude; drop the rule instead.
			if rule.Mode == models.LogicalAnd {
				return nil, false
			}
			continue
		}
		parts = append(parts, built)
	}
	if len(parts) == 0 {
		return nil, false
	}
	if len(parts) == 1 && !rule.Invert {
		return parts[0], true
	}
	logical := map[string]any{"type": "logical", "mode": rule.Mode, "rules": parts}
	if rule.Invert {
		logical["invert"] = true
	}
	return logical, true
}

// matcher builds one condition as a core rule with no action.
func (p *routePlan) matcher(condition models.RoutingCondition) (map[string]any, bool) {
	values := condition.CleanValues()
	if len(values) == 0 {
		return nil, false
	}

	var built map[string]any
	switch condition.Kind {
	case models.SourceApps:
		processPaths := extractProcessPaths(values)
		processNames := mergeProcessNames(expandProcessNames(values), processPaths)
		byName := map[string]any{"process_name": processNames}
		byPath := map[string]any{"process_path": processPaths}
		switch {
		case len(processNames) > 0 && len(processPaths) > 0:
			// Two fields in one rule would have to both match; either is
			// meant.
			built = map[string]any{"type": "logical", "mode": "or", "rules": []map[string]any{byName, byPath}}
		case len(processPaths) > 0:
			built = byPath
		case len(processNames) > 0:
			built = byName
		}

	case models.SourceDomains:
		exact, suffixes := splitDomains(values)
		built = map[string]any{}
		if len(exact) > 0 {
			built["domain"] = exact
		}
		if len(suffixes) > 0 {
			built["domain_suffix"] = suffixes
		}

	case models.SourceIP:
		built = map[string]any{"ip_cidr": values}

	case models.SourceDomainRegex:
		built = map[string]any{"domain_regex": values}

	case models.SourcePort:
		single, ranges := splitPorts(values)
		built = map[string]any{}
		if len(single) > 0 {
			built["port"] = single
		}
		if len(ranges) > 0 {
			built["port_range"] = ranges
		}

	case models.SourceProtocol:
		built = map[string]any{"protocol": values}

	case models.SourceNetwork:
		built = map[string]any{"network": values}

	case models.SourceGeoSite, models.SourceGeoIP:
		// Geo matching is a rule-set reference. A value with no set to point
		// at is left out: a rule naming an undeclared tag stops the core from
		// starting at all.
		tags := []string{}
		for _, value := range values {
			if set, ok := p.geo.resolve(condition.Kind, value); ok {
				tags = append(tags, p.declare(set))
			}
		}
		if len(tags) > 0 {
			built = map[string]any{"rule_set": tags}
		}

	case models.SourceRuleSet:
		tags := []string{}
		for _, address := range values {
			if set, ok := p.listSet(address, false); ok {
				tags = append(tags, p.declare(set))
			}
		}
		if len(tags) > 0 {
			built = map[string]any{"rule_set": tags}
		}
	}

	if len(built) == 0 {
		return nil, false
	}
	if condition.Invert {
		built["invert"] = true
	}
	return built, true
}

// withAction attaches the destination to a matcher.
func (p *routePlan) withAction(matcher map[string]any, action, server string) map[string]any {
	switch action {
	case models.ActionBlock:
		matcher["action"] = "reject"
	case models.ActionDrop:
		matcher["action"] = "reject"
		matcher["method"] = "drop"
	case models.ActionDirect:
		matcher["outbound"] = DirectTag
	default:
		matcher["outbound"] = p.proxyOutbound(server)
	}
	return matcher
}

// proxyOutbound is where proxied traffic for a server id goes: its own
// outbound when there is one, otherwise the connected server.
func (p *routePlan) proxyOutbound(server string) string {
	if tag, ok := p.outboundFor[server]; ok && server != "" {
		return tag
	}
	return ExitTag
}

// finalOutbound is where traffic goes when no rule matched. A "block" or
// "drop" default is handled by the catch-all rule, so this only has to pick a
// side.
func (p *routePlan) finalOutbound() string {
	if p.settings.DefaultAction == models.ActionProxy {
		return p.proxyOutbound(p.settings.DefaultServer)
	}
	return DirectTag
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

// domainMatcher is the part of a rule a DNS rule can use: its domain
// conditions, without the ones that only make sense for a connection (an
// app, a port). It reports false when the rule has no domains to resolve.
//
// A rule list or geo set is only used when it is known to hold domains alone.
// The DNS section treats an address range in a set as a filter on the
// answer, which sends every query to that rule's server first to find out.
func (p *routePlan) domainMatcher(rule models.RoutingRule) (map[string]any, bool) {
	if !rule.MatchesDomains() {
		return nil, false
	}
	parts := []map[string]any{}
	for _, condition := range rule.Matchers() {
		if !condition.Domains() || condition.Invert {
			continue
		}
		var built map[string]any
		switch condition.Kind {
		case models.SourceGeoSite:
			tags := []string{}
			for _, value := range condition.Values {
				if set, ok := p.geo.resolve(condition.Kind, value); ok {
					tags = append(tags, p.declare(set))
				}
			}
			if len(tags) > 0 {
				built = map[string]any{"rule_set": tags}
			}
		case models.SourceRuleSet:
			tags := []string{}
			for _, address := range condition.Values {
				if set, ok := p.listSet(address, true); ok {
					tags = append(tags, p.declare(set))
				}
			}
			if len(tags) > 0 {
				built = map[string]any{"rule_set": tags}
			}
		default:
			built, _ = p.matcher(condition)
		}
		if len(built) > 0 {
			parts = append(parts, built)
		}
	}
	switch len(parts) {
	case 0:
		return nil, false
	case 1:
		return parts[0], true
	default:
		return map[string]any{"type": "logical", "mode": "or", "rules": parts}, true
	}
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
	// listUpdateInterval is how often a rule list from a URL is refreshed.
	// These are usually maintained lists — blocked sites, ad servers — that
	// change daily.
	listUpdateInterval = "24h"
)

// RuleSetTag names the set a geo value refers to.
func RuleSetTag(kind, value string) string {
	return kind + "-" + value
}

// RuleList is a rule list from a URL that the app downloaded and converted,
// because the core only reads its own formats.
type RuleList struct {
	// Path is a source rule-set with everything in the list.
	Path string
	// DomainsPath holds only its domain entries, for DNS rules; empty when
	// the list has none.
	DomainsPath string
}

// ListTag names the rule-set for a list URL. The URL itself cannot be a tag:
// it would be long and show up in every log line.
func ListTag(address string) string {
	sum := sha256.Sum256([]byte(address))
	return "list-" + hex.EncodeToString(sum[:5])
}

// NativeListFormat reports whether the core can read the list at address
// itself, and in which format: a compiled .srs, or a source .json rule-set.
// Anything else — plain lists of domains and addresses — has to be
// converted by the app.
func NativeListFormat(address string) (string, bool) {
	parsed, err := url.Parse(address)
	if err != nil {
		return "", false
	}
	switch strings.ToLower(path.Ext(parsed.Path)) {
	case ".srs":
		return "binary", true
	case ".json":
		return "source", true
	}
	return "", false
}

// listSet returns the rule-set declaration for a list URL, or false when the
// list is not available. domainsOnly asks for a set safe to use in DNS rules.
func (p *routePlan) listSet(address string, domainsOnly bool) (map[string]any, bool) {
	tag := ListTag(address)
	if format, ok := NativeListFormat(address); ok {
		if domainsOnly {
			// Nothing says what a compiled list holds; see domainMatcher.
			return nil, false
		}
		return map[string]any{
			"type":            "remote",
			"tag":             tag,
			"format":          format,
			"url":             address,
			"download_detour": ExitTag,
			"update_interval": listUpdateInterval,
		}, true
	}

	list, ok := p.lists[address]
	if !ok {
		return nil, false
	}
	file := list.Path
	if domainsOnly {
		tag += "-domains"
		file = list.DomainsPath
	}
	if file == "" {
		return nil, false
	}
	return map[string]any{
		"type":   "local",
		"tag":    tag,
		"format": "source",
		"path":   file,
	}, true
}

// geoSources decides where each geo value's rule-set comes from.
type geoSources struct {
	local  map[string]string
	custom map[string]bool
}

// resolve returns the rule-set declaration for a geo value, or false when
// there is none to use.
func (g geoSources) resolve(kind, value string) (map[string]any, bool) {
	tag := RuleSetTag(kind, value)
	if path, ok := g.local[tag]; ok {
		return map[string]any{
			"type":   "local",
			"tag":    tag,
			"format": "source",
			"path":   path,
		}, true
	}
	if g.custom[kind] {
		return nil, false
	}
	// The built-in sets are plain codes. An @attribute or ! only means
	// something in a .dat file, so such a value has no built-in set.
	if strings.ContainsAny(value, "@!") {
		return nil, false
	}

	template := geoIPURL
	if kind == models.SourceGeoSite {
		template = geoSiteURL
	}
	return map[string]any{
		"type":            "remote",
		"tag":             tag,
		"format":          "binary",
		"url":             fmt.Sprintf(template, value),
		"download_detour": ExitTag,
		"update_interval": ruleSetUpdateInterval,
	}, true
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

// buildRouteSection assembles the route block, including any rule-sets the
// graph refers to. The sets are only declared when something actually uses
// one, so a configuration without geo rules makes no network requests for
// them.
//
// Call it after the rules and the DNS section are built: both declare sets as
// they go.
func (p *routePlan) buildRouteSection(rules []map[string]any) map[string]any {
	route := map[string]any{
		"rules":                 rules,
		"final":                 p.finalOutbound(),
		"auto_detect_interface": true,
		// Look up which program opened each connection, for the connections
		// screen. Without it the core only does so when a rule names an app.
		"find_process":            true,
		"default_domain_resolver": map[string]any{"server": dnsDirectTag},
	}
	if len(p.sets) > 0 {
		route["rule_set"] = p.sets
	}
	return route
}

// ruleSets declares every rule-set the graph refers to. Kept for tests,
// which ask about declarations without building a whole config.
func ruleSets(settings models.AppSettings, geo geoSources) []map[string]any {
	plan := newRoutePlan(settings, geo, nil, nil)
	plan.buildRouteRules(nil)
	return plan.sets
}

// buildRouteRules is the rules alone, for tests.
func buildRouteRules(settings models.AppSettings, serverDomains []string, geo geoSources) ([]map[string]any, int) {
	rules, _, matched := newRoutePlan(settings, geo, nil, nil).buildRouteRules(serverDomains)
	return rules, matched
}
